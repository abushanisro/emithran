#!/usr/bin/env bash
# Checks that the services of a Railway environment can reach each other on the private network, from inside it.
#
#   deploy/railway/probe-environment.sh <staging|production>
#
# A temporary job calls the backend, PostgREST, both CAD engines and (when it exists) the frontend by their private names, and reports the
# HTTP status and whether each name resolves over IPv4, IPv6 or both. This matters because a service that listens only on 0.0.0.0 (IPv4)
# cannot be reached by a name that resolves to IPv6 only. The job is deleted afterwards, also on failure. It sends no credential.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: probe-environment.sh <staging|production>}"
env_file_for "$environment" >/dev/null
require_cli
railway environment "$environment" >/dev/null
project_id="${RAILWAY_PROJECT_ID:-$(project_id_of)}"
[ -n "$project_id" ] || { echo "cannot tell which Railway project this is" >&2; exit 2; }
if service_exists "$environment" probe; then echo "refusing: $environment already has a probe service (a failed earlier run?): delete it first" >&2; exit 1; fi

work="$(mktemp -d)"
created=""
cleanup() {
  status=$?
  rm -rf "$work"
  [ -z "$created" ] || railway service delete --service "$created" --environment "$environment" --yes >/dev/null 2>&1 || echo "WARNING: could not delete the temporary service $created: delete it in the Railway dashboard" >&2
  exit $status
}
trap cleanup EXIT
cp "$here"/probe/* "$work/"

# only the services this environment has
vars=()
for pair in backend:BACKEND_HOST postgrest:POSTGREST_HOST cad-engine:CAD_ENGINE_HOST ecad-engine:ECAD_ENGINE_HOST frontend:FRONTEND_HOST; do
  svc="${pair%%:*}"; var="${pair##*:}"
  if service_exists "$environment" "$svc"; then vars+=(--variables "$var=\${{$svc.RAILWAY_PRIVATE_DOMAIN}}"); fi
done
[ "${#vars[@]}" -gt 0 ] || { echo "$environment has no services to probe" >&2; exit 2; }

add_service_quietly --service probe "${vars[@]}"
created="probe"
echo "[probe] building and running inside $environment..."
(cd "$work" && railway up --service probe --environment "$environment" --project "$project_id" --ci >"$work/build.log" 2>&1) \
  || { tail -15 "$work/build.log" >&2; echo "[probe] the build failed" >&2; exit 1; }
wait_for_log probe "$environment" "PROBE DONE" 300 || { echo "[probe] did not finish" >&2; exit 1; }
railway service logs --service probe --environment "$environment" 2>&1 | grep -E "^PROBE " | sed 's/^PROBE //' | grep -v '^DONE$'
