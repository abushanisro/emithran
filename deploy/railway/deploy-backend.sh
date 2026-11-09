#!/usr/bin/env bash
# Deploys the backend API into a Railway environment that already has Postgres, PostgREST and the two CAD engines.
#
#   deploy/railway/deploy-backend.sh <staging|production>
#
# The backend's Dockerfile compiles a Rust nesting engine from the repo's core/ folder, which docker-compose passes as a NAMED build context
# (`additional_contexts: core: ./core`). `railway up` uploads one folder and cannot pass a second context, so the build folder is assembled
# here: backend/ plus the three paths of core/ the Dockerfile copies (Cargo.toml, Cargo.lock, crates), and a Dockerfile.railway that is the
# repo's Dockerfile UNCHANGED behind two lines, `FROM scratch AS core` and `COPY core /`. BuildKit resolves `COPY --from=core` to a build
# stage of that name before it looks for a named context, so the repo's Dockerfile is the one that builds, byte for byte.
#
# Settings are those of the docker-compose.prod.yml backend service. Secrets (database JWT secret, the BFF forward secret, the engine keys and
# the S3 keys) are read from env/<stage|prd>.env and sent through stdin; the other values from that file are passed as they are. The service
# reaches Postgres' API and the engines on Railway's private network and gets NO public domain.
# It refuses to run when the environment already has a backend service. See deploy/railway/README.md.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: deploy-backend.sh <staging|production>}"
envfile="$(env_file_for "$environment")"

# Values the backend cannot start without (docker-compose.prod.yml marks each one required)
plain_required=(APP_ENV AUTH0_DOMAIN AUTH0_AUDIENCE AUTH0_CLAIM_NAMESPACE AUTH0_TRUSTED_CONNECTIONS CORS_ORIGIN S3_BUCKET S3_REGION)
secret_required=(DB_JWT_SECRET BFF_FORWARD_SECRET CAD_ENGINE_API_KEY ECAD_ENGINE_API_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY)
# Optional in compose (it supplies a default): passed through only when the env file sets them
plain_optional=(S3_ENDPOINT MAX_UPLOAD_MB SESSION_IDLE_TIMEOUT_ENABLED AUTH_DECISION_CACHE_SECONDS ORG_THROTTLE_LIMIT ORG_THROTTLE_TTL ARCHIVE_MAX_EXPANDED_MB HEAVY_WORK_MAX_CONCURRENT HEAVY_WORK_MAX_PER_TENANT FX_RATE_MAX_CHANGE_PERCENT AI_DISABLED AI_USER_DAILY_TOKENS AI_ORG_DAILY_TOKENS AI_GLOBAL_DAILY_TOKENS AI_MAX_CONCURRENT_PER_USER CAD_CORE NESTING_ENGINE)
secret_optional=(ANTHROPIC_API_KEY)

require_cli
[ -f "$envfile" ] || { echo "no env file: $envfile" >&2; exit 2; }
require_env_values "$envfile" "${plain_required[@]}" "${secret_required[@]}" || exit 2
for f in backend/Dockerfile core/Cargo.toml core/Cargo.lock; do [ -f "$REPO/$f" ] || { echo "missing $f" >&2; exit 2; }; done
[ -d "$REPO/core/crates" ] || { echo "missing core/crates" >&2; exit 2; }

railway environment "$environment" >/dev/null
for dep in postgres postgrest cad-engine ecad-engine; do
  service_exists "$environment" "$dep" || { echo "$environment has no $dep service: deploy it first (deploy/railway/README.md)" >&2; exit 2; }
done
if service_exists "$environment" backend; then echo "refusing: $environment already has a backend service" >&2; exit 1; fi
project_id="${RAILWAY_PROJECT_ID:-$(project_id_of)}"
[ -n "$project_id" ] || { echo "cannot tell which Railway project this is" >&2; exit 2; }

work="$(mktemp -d)"
created=""
cleanup() {
  status=$?
  rm -rf "$work"
  if [ -n "$created" ] && [ "$status" -ne 0 ]; then
    echo "removing the failed $created service" >&2
    railway service delete --service "$created" --environment "$environment" --yes >/dev/null 2>&1 || echo "WARNING: could not delete $created: delete it in the Railway dashboard" >&2
  fi
  exit $status
}
trap cleanup EXIT

echo "[backend] assembling the build folder..."
mkdir -p "$work/core"
tar -C "$REPO/backend" --exclude=./node_modules --exclude=./dist --exclude=./coverage --exclude=./.git -cf - . | tar -C "$work" -xf -
cp "$REPO/core/Cargo.toml" "$REPO/core/Cargo.lock" "$work/core/"
cp -R "$REPO/core/crates" "$work/core/crates"
{ printf 'FROM scratch AS core\nCOPY core /\n'; cat "$REPO/backend/Dockerfile"; } > "$work/Dockerfile.railway"

# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
vars=(
  --variables "RAILWAY_DOCKERFILE_PATH=Dockerfile.railway"
  --variables "NODE_ENV=production" --variables "PORT=4000"
  --variables "TRUST_CLOUDFLARE_HEADERS=true" --variables "TRUST_PROXY=0"
  --variables "NODE_OPTIONS=--max-old-space-size=1434"
  --variables 'POSTGREST_URL=http://${{postgrest.RAILWAY_PRIVATE_DOMAIN}}:3000'
  --variables 'CAD_ENGINE_URL=http://${{cad-engine.RAILWAY_PRIVATE_DOMAIN}}:5055'
  --variables 'ECAD_ENGINE_URL=http://${{ecad-engine.RAILWAY_PRIVATE_DOMAIN}}:5100'
)
for k in "${plain_required[@]}"; do vars+=(--variables "$k=$(env_value "$envfile" "$k")"); done
for k in "${plain_optional[@]}"; do v="$(env_value "$envfile" "$k")"; [ -z "$v" ] || vars+=(--variables "$k=$v"); done

echo "[backend] creating the service in $environment..."
add_service_quietly --service backend "${vars[@]}"
created="backend"
for k in "${secret_required[@]}"; do env_value "$envfile" "$k" | set_secret backend "$environment" "$k"; done
for k in "${secret_optional[@]}"; do v="$(env_value "$envfile" "$k")"; [ -z "$v" ] || printf '%s' "$v" | set_secret backend "$environment" "$k"; done

echo "[backend] building (the Rust nester and the Nest app) and starting; this can take several minutes..."
if ! (cd "$work" && railway up --service backend --environment "$environment" --project "$project_id" --ci >"$work/build.log" 2>&1); then
  tail -30 "$work/build.log" >&2; echo "[backend] the build failed" >&2; exit 1
fi

echo "[backend] waiting for it to start..."
if wait_for_log backend "$environment" "API Gateway running on" 420; then
  railway service logs --service backend --environment "$environment" 2>&1 | grep -E "Bootstrap\] (Environment|API Gateway)" | tail -2 | cut -c1-200
  created=""
  echo "done: backend is running in $environment (private address only)."
else
  railway service logs --service backend --environment "$environment" 2>&1 | tail -25 | cut -c1-220 >&2
  echo "[backend] did not report that it is serving within 7 minutes" >&2
  exit 1
fi
