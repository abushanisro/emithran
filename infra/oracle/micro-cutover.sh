#!/usr/bin/env bash
# Moves the public site from the machine serving it now (the Mac) to the app server, in the one safe order, and rolls back by itself if the public
# checks fail. About 5 minutes of downtime. Run it from the OLD host (it needs docker there and SSH to the app server).
#
#   APP_HOST=<ip> [PUBLIC_URL=https://app.emithran.com] [OLD_PREFIX=emithran-prd] [DRY_RUN=1] infra/oracle/micro-cutover.sh
#
# Order matters: the tunnel connector decides which copy of the data the public sees. Two connectors at once would split traffic between an old and a
# new copy, so the old one stops FIRST; the old backend and frontend stop next (no writes while the data is copied); the new connector starts LAST.
# The old host's containers are only STOPPED, never removed: rollback is `docker start`. Ctrl-C at the prompt changes nothing.
set -Eeuo pipefail
: "${APP_HOST:?}"
PUBLIC_URL="${PUBLIC_URL:-https://app.emithran.com}"; OLD="${OLD_PREFIX:-emithran-prd}"; KEY="${SSH_KEY:-$HOME/.ssh/emithran_prod_ed25519}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run() { if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: $*"; else "$@"; fi; }
new() { run ssh -i "$KEY" -o BatchMode=yes "ubuntu@$APP_HOST" "cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f docker-compose.micro-app.yml --env-file env/prd.env $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo 000; }

rollback() {
  echo "!! ROLLBACK: stopping the new connector and restarting the old host" >&2
  run ssh -i "$KEY" -o BatchMode=yes "ubuntu@$APP_HOST" "docker stop emithran-prd-cloudflared-1" || true
  run docker start "$OLD-postgres-1" "$OLD-postgrest-1" "$OLD-cad-engine-1" "$OLD-ecad-engine-1" || true
  run docker start "$OLD-backend-1" "$OLD-frontend-1" || true
  sleep 15; run docker start "$OLD-cloudflared-1" || true
  echo "old host restarted; check $PUBLIC_URL in a minute" >&2
}

echo "== preflight"
ready="$(ssh -i "$KEY" -o BatchMode=yes "ubuntu@$APP_HOST" "docker exec emithran-prd-backend-1 node -e \"fetch('http://backend:4000/api/health/ready').then(r=>console.log(r.status))\"" 2>/dev/null || echo 0)"
[ "$ready" = 200 ] || { echo "the new backend is not ready (got $ready): fix that first, nothing was changed" >&2; exit 2; }
[ "$(code "$PUBLIC_URL/api/health")" = 200 ] || echo "note: the site is not answering from the old host right now"
docker inspect "$OLD-cloudflared-1" >/dev/null
echo "new backend ready; old host found. This stops the public site for about 5 minutes."
if [ "${DRY_RUN:-}" != 1 ]; then read -r -p "Type GO to move $PUBLIC_URL to $APP_HOST: " a; [ "$a" = GO ] || { echo "cancelled, nothing changed"; exit 1; }; fi

trap rollback ERR
echo "== 1/5 old connector off (site down from here)"; run docker stop "$OLD-cloudflared-1"
echo "== 2/5 old backend and frontend off (no more writes)"; run docker stop "$OLD-backend-1" "$OLD-frontend-1"
echo "== 3/5 final database copy, proven table by table"; run env APP_HOST="$APP_HOST" RESET=1 bash "$here/micro-db.sh"
echo "== 4/5 new backend, frontend and connector on"; new "up -d --no-build backend frontend"; new "up -d --no-build cloudflared"
echo "== 5/5 public checks (up to 2 minutes)"
ok=0; for i in $(seq 1 24); do
  if [ "${DRY_RUN:-}" = 1 ]; then ok=1; break; fi
  if [ "$(code "$PUBLIC_URL/api/health")" = 200 ] && [ "$(code "$PUBLIC_URL/auth/login")" = 307 ]; then ok=1; break; fi; sleep 5
done
[ "$ok" = 1 ] || { echo "the public checks failed" >&2; false; }
trap - ERR
echo "DONE: $PUBLIC_URL is served from $APP_HOST. The old host's containers are stopped, not removed (rollback: docker start them, after stopping the new connector)."
