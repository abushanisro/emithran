#!/usr/bin/env bash
# Releases one git commit to the two Oracle servers, from this machine, and rolls back by itself if the release does not come up healthy.
#
#   infra/oracle/micro-release.sh <git-ref>          # settings from ~/.emithran/micro.env (APP_HOST, ENGINE_HOST, ENGINE_PRIVATE_IP) or the environment
#   DRY_RUN=1 infra/oracle/micro-release.sh <ref>    # the checks and the plan, no change anywhere
#
# What it does, in this order, and why:
#  1. Refuses an unknown ref, a ref without the micro files, or servers that are not healthy NOW (a release onto a sick system hides the cause).
#  2. Builds the four images for linux/amd64 from `git archive <ref>` (never your working tree) under the project name emithran-amd64.
#  3. Ships only the images whose content changed (docker save | ssh docker load: no registry, no token) and tags what runs now as good-<old sha>.
#  4. Runs the release's own database migrations through an encrypted SSH forward to Postgres (each runs in its own transaction; a failure stops here,
#     before any service was replaced; the database stays at the last good migration).
#  5. Engines first, then the web tier; each waits for its health checks. Postgres and the tunnel connector are never restarted by a release.
#  6. Checks the public site. Any failure from step 3 on puts the last good images back and says so.
# The previous images stay on the servers as good-<sha>; `ROLLBACK=1 infra/oracle/micro-release.sh <old-ref>` is not needed: the failure path does it.
set -Eeuo pipefail
ref="${1:?usage: micro-release.sh <git-ref>}"
[ -f "${MICRO_ENV:-$HOME/.emithran/micro.env}" ] && { set -a; . "${MICRO_ENV:-$HOME/.emithran/micro.env}"; set +a; }
: "${APP_HOST:?}" "${ENGINE_HOST:?}" "${ENGINE_PRIVATE_IP:?}"
KEY="${SSH_KEY:-$HOME/.ssh/emithran_prod_ed25519}"; ENV_FILE="${ENV_FILE:-$HOME/emithran-prod-run/env/prd.env}"; PUBLIC_URL="${PUBLIC_URL:-https://app.emithran.com}"
IP=emithran-amd64
repo="$(git rev-parse --show-toplevel)"; cd "$repo"
sha="$(git rev-parse --verify --quiet "$ref^{commit}")" || { echo "unknown git ref: $ref" >&2; exit 2; }
short="${sha:0:8}"
for f in docker-compose.prod.yml docker-compose.data.yml docker-compose.micro-app.yml docker-compose.micro-engines.yml backend/scripts/migrate.ts; do
  git cat-file -e "$sha:$f" 2>/dev/null || { echo "release $ref ($short) does not contain $f: nothing was changed." >&2; exit 2; }
done
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (the build reads the public settings from it)" >&2; exit 2; }
run() { if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: $*"; else "$@"; fi; }
ssh_() { local h="$1"; shift; ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ubuntu@$h" "$@"; }
dc() { local h="$1" o="$2" e="$3"; shift 3; ssh_ "$h" "cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f $o --env-file $e $*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || echo 000; }

echo "== 1/6 preflight (read-only)"
ssh_ "$APP_HOST" true && ssh_ "$ENGINE_HOST" true
old="$(ssh_ "$APP_HOST" 'cat /opt/emithran/.release-sha 2>/dev/null || echo unknown')"; oldshort="${old:0:8}"
ready="$(ssh_ "$APP_HOST" "docker exec emithran-prd-backend-1 node -e \"fetch('http://backend:4000/api/health/ready').then(r=>console.log(r.status))\"" 2>/dev/null || echo 0)"
[ "$ready" = 200 ] || { echo "the running backend is not ready (got $ready): fix that first; nothing was changed" >&2; exit 2; }
for h in "$APP_HOST" "$ENGINE_HOST"; do
  free_gb="$(ssh_ "$h" "df -BG --output=avail / | tail -1 | tr -dc 0-9")"; [ "${free_gb:-0}" -ge 5 ] || { echo "$h has only ${free_gb}G of disk free: free space first" >&2; exit 2; }
done
echo "running now: ${oldshort}; releasing ${short} ($ref); servers healthy, disk ok"
[ "$old" = "$sha" ] && echo "note: this commit is already the one running; images are rebuilt and only changed ones are replaced"

echo "== 2/6 build amd64 images from $short"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
git archive "$sha" | tar -x -C "$work"
run bash -c "cd '$work' && DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose -p $IP -f docker-compose.prod.yml -f docker-compose.data.yml --env-file '$ENV_FILE' build backend frontend ecad-engine cad-engine"

changed=(); shipped_app=(); shipped_eng=()
echo "== 3/6 ship what changed; keep what runs now as good-$oldshort"
for s in cad-engine ecad-engine backend frontend; do
  case "$s" in cad-engine|ecad-engine) h="$ENGINE_HOST" ;; *) h="$APP_HOST" ;; esac
  new_id="$(docker image inspect "$IP-$s" --format '{{.Id}}' 2>/dev/null || echo none)"
  cur_id="$(ssh_ "$h" "docker image inspect emithran-prd-$s:latest --format '{{.Id}}' 2>/dev/null || echo none")"
  if [ "$new_id" = "$cur_id" ]; then echo "  $s: unchanged"; continue; fi
  echo "  $s: changed, shipping $(( $(docker image inspect "$IP-$s" --format '{{.Size}}' 2>/dev/null || echo 0) / 1000000 )) MB"
  run ssh_ "$h" "docker tag emithran-prd-$s:latest emithran-prd-$s:good-$oldshort 2>/dev/null || true"
  if [ "${DRY_RUN:-}" != 1 ]; then docker save "$IP-$s" | gzip -1 | ssh_ "$h" "gunzip | docker load >/dev/null && docker tag $IP-$s emithran-prd-$s:latest && docker image rm $IP-$s >/dev/null 2>&1 || true"; fi
  case "$s" in cad-engine|ecad-engine) shipped_eng+=("$s") ;; *) shipped_app+=("$s") ;; esac
done

rollback() {
  echo "!! ROLLBACK to $oldshort" >&2
  for s in ${shipped_eng[@]+"${shipped_eng[@]}"}; do ssh_ "$ENGINE_HOST" "docker tag emithran-prd-$s:good-$oldshort emithran-prd-$s:latest && cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f docker-compose.micro-engines.yml --env-file env/engines.env up -d --no-build --force-recreate $s" || true; done
  for s in ${shipped_app[@]+"${shipped_app[@]}"}; do ssh_ "$APP_HOST" "docker tag emithran-prd-$s:good-$oldshort emithran-prd-$s:latest && cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f docker-compose.micro-app.yml --env-file env/prd.env up -d --no-build --force-recreate $s" || true; done
  echo "previous images restored (the database stays at its last good migration: fix forward with a new migration if the old code cannot run on it)" >&2
}
[ "${DRY_RUN:-}" = 1 ] || trap rollback ERR

echo "== 4/6 migrations (the release's own files, through an encrypted SSH forward; each in its own transaction)"
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: forward 127.0.0.1:15432 -> $APP_HOST:5432, run migrate.ts --env prd from the export"; else
  ssh -i "$KEY" -o BatchMode=yes -f -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15432:127.0.0.1:5432 "ubuntu@$APP_HOST"
  fwd="$(pgrep -f '127.0.0.1:15432:127.0.0.1:5432' | head -1)"; trap 'kill "$fwd" 2>/dev/null || true; rm -rf "$work"' EXIT
  python3 - "$work" "$ENV_FILE" <<'PY'
import sys,urllib.parse
work,envf=sys.argv[1:3]; d={}
for l in open(envf):
    if '=' in l and not l.startswith('#'): k,v=l.rstrip('\n').split('=',1); d[k]=v
d['MIGRATE_DATABASE_URL']='postgresql://postgres:%s@host.docker.internal:15432/postgres?sslmode=disable'%urllib.parse.quote(d['POSTGRES_PASSWORD'],safe='')
open(work+'/.migrate.env','w').write('\n'.join(f'{k}={v}' for k,v in d.items())+'\n')
PY
  chmod 600 "$work/.migrate.env"
  docker run --rm --add-host host.docker.internal:host-gateway -v "$work:/work" -w /work/backend node:24 sh -c 'npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 && npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env prd --env-file ../.migrate.env' 2>&1 | tail -5
  kill "$fwd" 2>/dev/null || true; trap rollback ERR
fi

echo "== 5/6 engines first, then the web tier (each waits for its health checks)"
scp -i "$KEY" -o BatchMode=yes -q "$work/docker-compose.prod.yml" "$work/docker-compose.data.yml" "$work/docker-compose.micro-engines.yml" "ubuntu@$ENGINE_HOST:/opt/emithran/" 2>/dev/null || true
scp -i "$KEY" -o BatchMode=yes -q "$work/docker-compose.prod.yml" "$work/docker-compose.data.yml" "$work/docker-compose.micro-app.yml" "ubuntu@$APP_HOST:/opt/emithran/" 2>/dev/null || true
if [ "${#shipped_eng[@]}" -gt 0 ]; then run dc "$ENGINE_HOST" docker-compose.micro-engines.yml env/engines.env up -d --no-build --wait --wait-timeout 180 "${shipped_eng[*]}"; fi
if [ "${#shipped_app[@]}" -gt 0 ]; then run dc "$APP_HOST" docker-compose.micro-app.yml env/prd.env up -d --no-build --wait --wait-timeout 180 "${shipped_app[*]}"; fi

echo "== 6/6 checks"
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: readiness 200 inside the backend; $PUBLIC_URL/api/health 200 and /auth/login 307"; exit 0; fi
ok=0; for i in $(seq 1 24); do
  r="$(ssh_ "$APP_HOST" "docker exec emithran-prd-backend-1 node -e \"fetch('http://backend:4000/api/health/ready').then(r=>console.log(r.status))\"" 2>/dev/null || echo 0)"
  if [ "$r" = 200 ] && [ "$(code "$PUBLIC_URL/api/health")" = 200 ] && [ "$(code "$PUBLIC_URL/auth/login")" = 307 ]; then ok=1; break; fi; sleep 5
done
[ "$ok" = 1 ] || { echo "the release did not become healthy" >&2; false; }
trap - ERR
ssh_ "$APP_HOST" "echo $sha > /opt/emithran/.release-sha"
echo "DONE: $short is live (was $oldshort). Previous images kept as good-$oldshort."
