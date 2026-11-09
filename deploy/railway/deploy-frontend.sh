#!/usr/bin/env bash
# Deploys the Next.js frontend (the BFF the browser talks to) into a Railway environment that already has the backend.
#
#   deploy/railway/deploy-frontend.sh <staging|production>
#
# Dockerfile.frontend is the repo's own and is used UNCHANGED. It builds from the repo root, so the build folder is assembled here from the files
# git tracks, leaving out the top-level folders the repo's .dockerignore already excludes from this build (backend, the engines, memory, docs,
# tests...): the upload stays small, and the copied .dockerignore still decides what the build sees, exactly as `docker compose` does.
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are passed as variables Railway hands to the build as build args
# (each environment builds its own image). Settings are those of the docker-compose.prod.yml frontend service. Secrets (the Auth0 client
# secret and session secret, the BFF forward secret and the CAD engine key) go through stdin. The frontend reaches the backend and the CAD
# engine on Railway's private network and gets NO public domain: the tunnel is the way in.
# It refuses to run when the environment already has a frontend service. See deploy/railway/README.md.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: deploy-frontend.sh <staging|production>}"
envfile="$(env_file_for "$environment")"

# What the frontend cannot start without (docker-compose.prod.yml marks each one required)
plain_required=(NEXT_PUBLIC_API_GATEWAY_URL APP_BASE_URL AUTH0_DOMAIN AUTH0_AUDIENCE AUTH0_CLIENT_ID TRUSTED_STORAGE_HOSTS)
secret_required=(AUTH0_CLIENT_SECRET AUTH0_SECRET BFF_FORWARD_SECRET CAD_ENGINE_API_KEY)
# Top-level folders left out of the upload; each is also in the repo's .dockerignore (a test keeps it so)
upload_excludes=(backend cad-engine ecad-engine memory database supabase docs e2e test test-results playwright-report)

require_cli
[ -f "$envfile" ] || { echo "no env file: $envfile" >&2; exit 2; }
require_env_values "$envfile" "${plain_required[@]}" "${secret_required[@]}" || exit 2
[ -f "$REPO/Dockerfile.frontend" ] || { echo "missing Dockerfile.frontend" >&2; exit 2; }

railway environment "$environment" >/dev/null
for dep in backend cad-engine; do
  service_exists "$environment" "$dep" || { echo "$environment has no $dep service: deploy it first (deploy/railway/README.md)" >&2; exit 2; }
done
if service_exists "$environment" frontend; then echo "refusing: $environment already has a frontend service" >&2; exit 1; fi
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

echo "[frontend] assembling the build folder from the tracked files..."
pattern="^($(IFS='|'; echo "${upload_excludes[*]}"))/"
git -C "$REPO" ls-files -z | { grep -zvE "$pattern" || true; } | tar -C "$REPO" --null -T - -cf - | tar -C "$work" -xf -
[ -f "$work/Dockerfile.frontend" ] && [ -f "$work/package.json" ] && [ -f "$work/.dockerignore" ] || { echo "the build folder is missing Dockerfile.frontend, package.json or .dockerignore" >&2; exit 1; }

gateway="$(env_value "$envfile" NEXT_PUBLIC_API_GATEWAY_URL)"
max_upload="$(env_value "$envfile" MAX_UPLOAD_MB)"; max_upload="${max_upload:-50}"
# shellcheck disable=SC2016  # ${{...}} is Railway's reference syntax, resolved by Railway: it must reach the CLI unexpanded
vars=(
  --variables "RAILWAY_DOCKERFILE_PATH=Dockerfile.frontend"
  --variables "NODE_ENV=production"
  # Railway injects its own PORT (8080 here), which overrides the `ENV PORT=3000` in Dockerfile.frontend; the tunnel and the probe expect 3000.
  --variables "PORT=3000"
  --variables "NEXT_PUBLIC_API_GATEWAY_URL=$gateway"
  --variables "NEXT_PUBLIC_API_URL=$gateway/api/v1"
  --variables "NEXT_PUBLIC_MAX_UPLOAD_MB=$max_upload"
  --variables 'API_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:4000/api/v1'
  --variables 'CAD_ENGINE_URL=http://${{cad-engine.RAILWAY_PRIVATE_DOMAIN}}:5055'
)
for k in APP_BASE_URL AUTH0_DOMAIN AUTH0_AUDIENCE AUTH0_CLIENT_ID TRUSTED_STORAGE_HOSTS; do vars+=(--variables "$k=$(env_value "$envfile" "$k")"); done
sso="$(env_value "$envfile" NEXT_PUBLIC_AUTH0_SSO_CONNECTION)"
[ -z "$sso" ] || vars+=(--variables "NEXT_PUBLIC_AUTH0_SSO_CONNECTION=$sso")

echo "[frontend] creating the service in $environment..."
add_service_quietly --service frontend "${vars[@]}"
created="frontend"
for k in "${secret_required[@]}"; do env_value "$envfile" "$k" | set_secret frontend "$environment" "$k"; done

echo "[frontend] building (npm ci and next build) and starting; this can take several minutes..."
if ! (cd "$work" && railway up --service frontend --environment "$environment" --project "$project_id" --ci >"$work/build.log" 2>&1); then
  tail -30 "$work/build.log" >&2; echo "[frontend] the build failed" >&2; exit 1
fi

echo "[frontend] waiting for it to start..."
if wait_for_log frontend "$environment" "Ready in" 420; then
  railway service logs --service frontend --environment "$environment" 2>&1 | grep -E "Ready in|Local:|Network:" | tail -3 | cut -c1-160
  created=""
  echo "done: frontend is running in $environment (private address only)."
else
  railway service logs --service frontend --environment "$environment" 2>&1 | tail -25 | cut -c1-220 >&2
  echo "[frontend] did not report that it is serving within 7 minutes" >&2
  exit 1
fi
