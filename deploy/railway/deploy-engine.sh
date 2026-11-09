#!/usr/bin/env bash
# Deploys one of the two CAD engines into a Railway environment, built from its own Dockerfile, with the settings of its docker-compose.prod.yml service.
#
#   deploy/railway/deploy-engine.sh <staging|production> <cad-engine|ecad-engine>
#
# The engines parse untrusted uploaded files, so they get NO public domain: only the backend reaches them, on Railway's private network
# (http://cad-engine.railway.internal:5055, http://ecad-engine.railway.internal:5100). The API key is read from env/<stage|prd>.env and sent
# through stdin; it must be the value the backend uses.
# Railway cannot give a service a network with no internet, a read-only filesystem or dropped capabilities, which docker-compose.prod.yml does:
# that is a weaker isolation, accepted knowingly (deploy/railway/README.md).
# It refuses to run when the environment already has that service.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: deploy-engine.sh <staging|production> <cad-engine|ecad-engine>}"
engine="${2:?usage: deploy-engine.sh <staging|production> <cad-engine|ecad-engine>}"
envfile="$(env_file_for "$environment")"

case "$engine" in
  cad-engine)
    key_name=CAD_ENGINE_API_KEY
    required=(CAD_ENGINE_API_KEY CORS_ORIGIN)
    ;;
  ecad-engine)
    key_name=ECAD_ENGINE_API_KEY
    required=(ECAD_ENGINE_API_KEY)
    ;;
  *) echo "engine must be cad-engine or ecad-engine, got: $engine" >&2; exit 2 ;;
esac

require_cli
[ -f "$envfile" ] || { echo "no env file: $envfile" >&2; exit 2; }
require_env_values "$envfile" "${required[@]}" || exit 2
[ -f "$REPO/$engine/Dockerfile" ] || { echo "no $engine/Dockerfile" >&2; exit 2; }

railway environment "$environment" >/dev/null
if service_exists "$environment" "$engine"; then echo "refusing: $environment already has a $engine service" >&2; exit 1; fi
project_id="${RAILWAY_PROJECT_ID:-$(project_id_of)}"
[ -n "$project_id" ] || { echo "cannot tell which Railway project this is" >&2; exit 2; }

vars=(--variables "LOG_LEVEL=info")
if [ "$engine" = cad-engine ]; then
  max_upload="$(env_value "$envfile" MAX_UPLOAD_MB)"; max_upload="${max_upload:-50}"
  vars+=(
    --variables "PORT=5055" --variables "NODE_ENV=production" --variables "PYTHONUNBUFFERED=1"
    --variables "TEMP_DIR=/tmp/cad-files" --variables "TMPDIR=/tmp/cad-files"
    --variables "CORS_ORIGINS=$(env_value "$envfile" CORS_ORIGIN)"
    --variables "MAX_FILE_SIZE_MB=$max_upload" --variables "RATE_LIMIT_PER_MINUTE=10"
    --variables "MAX_CONCURRENT_ANALYSES=1" --variables "ANALYSIS_HARD_LIMIT_SECONDS=900"
    --variables "LINEAR_DEFLECTION=0.1" --variables "ANGULAR_DEFLECTION=0.5"
  )
else
  vars+=(--variables "PORT=5100")
fi

created=""
cleanup() {
  status=$?
  if [ -n "$created" ] && [ "$status" -ne 0 ]; then
    echo "removing the failed $created service" >&2
    railway service delete --service "$created" --environment "$environment" --yes >/dev/null 2>&1 || echo "WARNING: could not delete $created: delete it in the Railway dashboard" >&2
  fi
  exit $status
}
trap cleanup EXIT

echo "[$engine] creating the service in $environment..."
add_service_quietly --service "$engine" "${vars[@]}"
created="$engine"
env_value "$envfile" "$key_name" | set_secret "$engine" "$environment" "$key_name"

echo "[$engine] building from $engine/Dockerfile and starting (this can take several minutes)..."
build_log="$(mktemp)"
if ! (cd "$REPO/$engine" && railway up --service "$engine" --environment "$environment" --project "$project_id" --ci >"$build_log" 2>&1); then
  tail -25 "$build_log" >&2; rm -f "$build_log"; echo "[$engine] the build failed" >&2; exit 1
fi
rm -f "$build_log"

echo "[$engine] waiting for it to answer on its port..."
if wait_for_log "$engine" "$environment" "Uvicorn running on" 420; then
  railway service logs --service "$engine" --environment "$environment" 2>&1 | grep -E "Uvicorn running|Application startup complete" | tail -2 | cut -c1-160
  created=""
  echo "done: $engine is running in $environment (private address only)."
else
  railway service logs --service "$engine" --environment "$environment" 2>&1 | tail -20 | cut -c1-200 >&2
  echo "[$engine] did not report that it is serving within 7 minutes" >&2
  exit 1
fi
