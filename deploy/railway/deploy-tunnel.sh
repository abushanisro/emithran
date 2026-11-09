#!/usr/bin/env bash
# Deploys the Cloudflare Tunnel connector (`cloudflared`) into a Railway environment: the only way in from the internet.
#
#   deploy/railway/deploy-tunnel.sh <staging|production>
#
# The image and the command are those of the docker-compose.prod.yml `cloudflared` service (the image pinned by digest, `tunnel --no-autoupdate
# --metrics 127.0.0.1:2000 run`). Railway cannot set a command on a bare image, so a two-line Dockerfile is built FROM that pinned image, read from
# compose so there is one pin. TUNNEL_TOKEN is read from env/<stage|prd>.env and sent through stdin; it must be the token of THIS environment's tunnel
# (never the staging token in production).
# The connector dials OUT to Cloudflare, so the service has no public domain. Which hostnames reach the frontend and the backend is configured
# in the Cloudflare dashboard (Networks > Tunnels > the tunnel > Published application routes), using the private addresses this script prints.
# It refuses to run when the environment already has a tunnel service. See deploy/railway/README.md.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$here/../.." && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
trap 'on_error $LINENO' ERR

environment="${1:?usage: deploy-tunnel.sh <staging|production>}"
envfile="$(env_file_for "$environment")"

require_cli
[ -f "$envfile" ] || { echo "no env file: $envfile" >&2; exit 2; }
require_env_values "$envfile" TUNNEL_TOKEN || exit 2
image="$(grep -m1 -o 'cloudflare/cloudflared:[0-9.]*@sha256:[0-9a-f]\{64\}' "$REPO/docker-compose.prod.yml" || true)"
[ -n "$image" ] || { echo "no pinned cloudflared image in docker-compose.prod.yml" >&2; exit 2; }

railway environment "$environment" >/dev/null
for dep in frontend backend; do
  service_exists "$environment" "$dep" || { echo "$environment has no $dep service: the tunnel would have nothing to reach" >&2; exit 2; }
done
if service_exists "$environment" tunnel; then echo "refusing: $environment already has a tunnel service" >&2; exit 1; fi
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

cat > "$work/Dockerfile" <<EOF
# The cloudflared image of docker-compose.prod.yml, with that service's command (Railway cannot set a command on a bare image).
FROM $image
CMD ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:2000", "run"]
EOF

echo "[tunnel] creating the service in $environment..."
add_service_quietly --service tunnel
created="tunnel"
env_value "$envfile" TUNNEL_TOKEN | set_secret tunnel "$environment" TUNNEL_TOKEN

echo "[tunnel] building and starting..."
if ! (cd "$work" && railway up --service tunnel --environment "$environment" --project "$project_id" --ci >"$work/build.log" 2>&1); then
  tail -20 "$work/build.log" >&2; echo "[tunnel] the build failed" >&2; exit 1
fi

echo "[tunnel] waiting for it to register with Cloudflare..."
if wait_for_log tunnel "$environment" "Registered tunnel connection" 180; then
  railway service logs --service tunnel --environment "$environment" 2>&1 | grep -E "Registered tunnel connection" | tail -2 | cut -c1-170
  created=""
  echo "done: the tunnel is connected in $environment."
  echo "Cloudflare dashboard > Networks > Tunnels > this tunnel > Published application routes (in this order):"
  echo "  <host> + path /v1/*  ->  http://backend.railway.internal:4000"
  echo "  <host>               ->  http://frontend.railway.internal:3000"
else
  railway service logs --service tunnel --environment "$environment" 2>&1 | tail -15 | cut -c1-200 >&2
  echo "[tunnel] did not register with Cloudflare within 3 minutes (a wrong or revoked token is the usual cause)" >&2
  exit 1
fi
