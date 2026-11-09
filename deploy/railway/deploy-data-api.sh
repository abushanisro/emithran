#!/usr/bin/env bash
# Deploys PostgREST, the data API the backend talks to, into a Railway environment that already has a seeded Postgres.
#
#   deploy/railway/deploy-data-api.sh <staging|production>
#
# 1. A one-off job, inside the environment's private network, gives the `authenticator` role a new random password (the database has no
#    public address, so nothing outside can do this). The job service is deleted afterwards, also on failure.
# 2. PostgREST (the image pinned in docker-compose.prod.yml, the same one) is created with the settings of that compose service. Its
#    connection string and JWT secret are sent through stdin. DB_JWT_SECRET is read from env/<stage|prd>.env and must be the same value the
#    backend uses; the connection string uses the private address of the postgres service. PostgREST gets no public domain.
# It refuses to run when the environment already has a postgrest service. See deploy/railway/README.md.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: deploy-data-api.sh <staging|production>}"
envfile="$(env_file_for "$environment")"
require_cli
[ -f "$envfile" ] || { echo "no env file: $envfile" >&2; exit 2; }
require_env_values "$envfile" DB_JWT_SECRET || exit 2
[ "$(env_value "$envfile" DB_JWT_SECRET | wc -c | tr -d ' ')" -ge 32 ] || { echo "DB_JWT_SECRET must be at least 32 characters" >&2; exit 2; }

railway environment "$environment" >/dev/null
service_exists "$environment" postgres || { echo "$environment has no postgres: run provision-postgres.sh and seed-environment.sh first" >&2; exit 2; }
if service_exists "$environment" postgrest; then echo "refusing: $environment already has a postgrest service" >&2; exit 1; fi
project_id="${RAILWAY_PROJECT_ID:-$(project_id_of)}"
[ -n "$project_id" ] || { echo "cannot tell which Railway project this is" >&2; exit 2; }
PGRST_IMAGE="$(grep -m1 -o 'postgrest/postgrest@sha256:[0-9a-f]\{64\}' "$REPO/docker-compose.prod.yml" || true)"
[ -n "$PGRST_IMAGE" ] || { echo "no pinned postgrest image found in docker-compose.prod.yml" >&2; exit 2; }

work="$(mktemp -d)"
created=()
cleanup() {
  status=$?
  for name in ${created[@]+"${created[@]}"}; do
    railway service delete --service "$name" --environment "$environment" --yes >/dev/null 2>&1 || echo "WARNING: could not delete the temporary service $name: delete it in the Railway dashboard" >&2
  done
  rm -rf "$work"
  exit $status
}
trap cleanup EXIT

password="$(openssl rand -hex 24)"

echo "[roles] setting the authenticator password inside $environment's private network..."
cp "$here"/roles/* "$work/"
# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
add_service_quietly --service roles --variables 'TARGET_URL=${{postgres.DATABASE_URL}}'
created+=(roles)
printf '%s' "$password" | set_secret roles "$environment" AUTH_PW
(cd "$work" && railway up --service roles --environment "$environment" --project "$project_id" --ci >"$work/build.log" 2>&1) \
  || { tail -15 "$work/build.log" >&2; echo "[roles] the build failed" >&2; exit 1; }
wait_for_log roles "$environment" "authenticator password set" 300 || { railway service logs --service roles --environment "$environment" >&2 || true; echo "[roles] did not finish" >&2; exit 1; }
echo "[roles] done"
railway service delete --service roles --environment "$environment" --yes >/dev/null 2>&1 && created=()

echo "[postgrest] creating the service..."
add_service_quietly --image "$PGRST_IMAGE" --service postgrest \
  --variables "PGRST_DB_SCHEMAS=public" \
  --variables "PGRST_DB_EXTRA_SEARCH_PATH=public, extensions" \
  --variables "PGRST_DB_ANON_ROLE=anon" \
  --variables "PGRST_SERVER_HOST=0.0.0.0" \
  --variables "PGRST_SERVER_PORT=3000" \
  --variables "PGRST_DB_POOL=10" \
  --variables "PGRST_DB_PREPARED_STATEMENTS=false" \
  --variables "PGRST_LOG_LEVEL=warn"
created+=(postgrest)
# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway
printf 'postgres://authenticator:%s@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/emithran?sslmode=require' "$password" | set_secret postgrest "$environment" PGRST_DB_URI
# PostgREST reads the JWT secret from PGRST_JWT_SECRET: the value of DB_JWT_SECRET, which the backend uses under that name
env_value "$envfile" DB_JWT_SECRET | set_secret postgrest "$environment" PGRST_JWT_SECRET
unset password

echo "[postgrest] waiting for it to connect and load the schema..."
if wait_for_log postgrest "$environment" "Schema cache loaded" 300; then
  railway service logs --service postgrest --environment "$environment" 2>&1 | grep -E "Successfully connected|Schema cache loaded|API server listening" | tail -4 | cut -c1-160
  created=()   # keep postgrest: only temporary jobs are cleaned up
  echo "done: postgrest is running in $environment (private address only)."
else
  railway service logs --service postgrest --environment "$environment" 2>&1 | tail -15 | cut -c1-200 >&2
  echo "postgrest did not load the schema within 5 minutes" >&2
  created=(postgrest)  # remove the failed service so the next run starts clean
  exit 1
fi
