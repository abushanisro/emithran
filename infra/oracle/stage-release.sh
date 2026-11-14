#!/usr/bin/env bash
# Puts one git commit on the STAGING stack (stage.emithran.com, Docker on this Mac, project emithran-stage), so QA happens on staging and never on production.
#
#   infra/oracle/stage-release.sh <git-ref>          e.g. infra/oracle/stage-release.sh origin/develop
#   DRY_RUN=1 infra/oracle/stage-release.sh <ref>    the checks and the plan, no change anywhere
#
# Why it exists: staging used to be built from whatever happened to be checked out in the working tree (a half-finished branch could reach QA, and
# nobody could say which commit staging ran). This builds exactly `git archive <ref>` into a fixed folder, like the production release does.
# What it does, in this order:
#  1. Refuses an unknown ref, a ref without the compose files, a missing env/stage.env, a stopped Docker, or an env file that is not stage's.
#  2. Tags the images running now as good-<old sha> (rollback), exports the commit to STAGE_DIR (default ~/emithran-stage-run), builds there.
#  3. Runs the release's own database migrations on the STAGE database (each in its own transaction; a failure stops before any service is replaced).
#  4. Reloads PostgREST's schema cache, then recreates the services and waits for their health checks. Postgres, storage and the tunnel connector
#     keep running (their data lives in named Docker volumes, so moving the project folder loses nothing).
#  5. Runs the 30-second smoke test. Any failure from step 4 on puts the previous images back.
# The settings stay where they are (env/stage.env in this checkout, ignored by git); nothing is printed from it.
set -Eeuo pipefail
ref="${1:?usage: stage-release.sh <git-ref>}"
repo="$(git rev-parse --show-toplevel)"; cd "$repo"
sha="$(git rev-parse --verify --quiet "$ref^{commit}")" || { echo "unknown git ref: $ref" >&2; exit 2; }
short="${sha:0:8}"
for f in docker-compose.prod.yml docker-compose.data.yml backend/scripts/migrate.ts scripts/smoke.sh; do
  git cat-file -e "$sha:$f" 2>/dev/null || { echo "release $ref ($short) does not contain $f: nothing was changed." >&2; exit 2; }
done
ENV_FILE="${STAGE_ENV:-$repo/env/stage.env}"; STAGE_DIR="${STAGE_DIR:-$HOME/emithran-stage-run}"; PUBLIC_URL="${PUBLIC_URL:-https://stage.emithran.com}"
case "$STAGE_DIR" in */emithran-stage-run) ;; *) echo "STAGE_DIR must end in /emithran-stage-run (it is emptied on each release): $STAGE_DIR" >&2; exit 2 ;; esac
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 2; }
# the file must really be staging's: a production file here would build the wrong public settings and migrate the wrong database
grep -q '^APP_ENV=stage$' "$ENV_FILE" || { echo "$ENV_FILE does not say APP_ENV=stage: refusing (nothing was changed)" >&2; exit 2; }
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "Docker is not running" >&2; exit 2; }
P=emithran-stage; services="backend frontend cad-engine ecad-engine"
# The sand-casting worker runs when the settings name its socket (CASTING_WORKER_SOCKET, casting-worker/README.md): its compose profile is
# enabled and it is built, tagged for rollback and recreated with the other services. Without the setting casting analyses are not waited for.
profile=; if grep -qE '^CASTING_WORKER_SOCKET=.+' "$ENV_FILE"; then profile="--profile sand-casting"; services="$services casting-worker"; fi
run() { if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: $*"; else "$@"; fi; }
sd() { docker compose -p "$P" $profile -f docker-compose.prod.yml -f docker-compose.data.yml --env-file "$ENV_FILE" "$@"; }
old="$(cat "$STAGE_DIR/.release-sha" 2>/dev/null || echo unknown)"; oldshort="${old:0:8}"
echo "== 1/5 preflight: staging runs ${oldshort}; releasing ${short} ($ref)"
docker inspect "$P-postgres-1" >/dev/null 2>&1 || { echo "the staging database container $P-postgres-1 is not there: start the stack first" >&2; exit 2; }

echo "== 2/5 tag what runs now as good-$oldshort, export $short, build"
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: tag images, git archive $short -> $STAGE_DIR, docker compose build $services"; else
  for s in $services; do docker image inspect "$P-$s" >/dev/null 2>&1 && docker tag "$P-$s" "$P-$s:good-$oldshort" || true; done
  mkdir -p "$STAGE_DIR"; find "$STAGE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  git archive "$sha" | tar -x -C "$STAGE_DIR"; echo "$sha" > "$STAGE_DIR/.release-sha"
  cd "$STAGE_DIR"; sd build $services postgrest
fi

rollback() {
  echo "!! ROLLBACK to $oldshort" >&2
  cd "$STAGE_DIR" 2>/dev/null || true
  for s in $services; do docker image inspect "$P-$s:good-$oldshort" >/dev/null 2>&1 && docker tag "$P-$s:good-$oldshort" "$P-$s:latest" || true; done
  sd up -d --no-build --force-recreate $services || true
  echo "previous images restored (the database stays at its last good migration: fix forward with a new migration if the old code cannot run on it)" >&2
}

echo "== 3/5 migrations on the STAGE database (the release's own files, each in its own transaction)"
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: run migrate.ts --env stage inside a node container on $P"_db; else
  python3 - "$STAGE_DIR" "$ENV_FILE" <<'PY'
import sys,urllib.parse
work,envf=sys.argv[1:3]; d={}
for l in open(envf):
    if '=' in l and not l.startswith('#'): k,v=l.rstrip('\n').split('=',1); d[k]=v
# inside Docker the host is `postgres`; the traffic stays on Docker's private network, so TLS is switched off by the runner's own flag
d['MIGRATE_DATABASE_URL']='postgresql://postgres:%s@postgres:5432/postgres?sslmode=disable'%urllib.parse.quote(d['POSTGRES_PASSWORD'],safe='')
open(work+'/.migrate.env','w').write('\n'.join(f'{k}={v}' for k,v in d.items())+'\n')
PY
  chmod 600 "$STAGE_DIR/.migrate.env"
  docker run --rm --network "${P}_db" -v "$STAGE_DIR:/work" -w /work/backend node:24 sh -c 'npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 && npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env stage --env-file /work/.migrate.env' 2>&1 | tail -3
  rm -f "$STAGE_DIR/.migrate.env"
  # PostgREST caches the schema at start: a function a migration just created is unknown to it until it reloads (SIGUSR1: in place, no downtime)
  docker kill -s SIGUSR1 "$P-postgrest-1" >/dev/null 2>&1 && sleep 3 || echo "note: could not signal PostgREST; restart it if the release added database functions" >&2
  trap rollback ERR
fi

echo "== 4/5 recreate the services (each waits for its health checks)"
run sd up -d --no-build --wait --wait-timeout 240 $services postgrest

echo "== 5/5 smoke test"
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY: scripts/smoke.sh $PUBLIC_URL"; exit 0; fi
ok=0; for _ in $(seq 1 12); do if bash "$STAGE_DIR/scripts/smoke.sh" "$PUBLIC_URL" >/dev/null 2>&1; then ok=1; break; fi; sleep 5; done
if [ "$ok" != 1 ]; then bash "$STAGE_DIR/scripts/smoke.sh" "$PUBLIC_URL" || true; echo "the smoke test failed" >&2; false; fi
trap - ERR
bash "$STAGE_DIR/scripts/smoke.sh" "$PUBLIC_URL"
echo "DONE: $short is on staging (was $oldshort). Previous images kept as good-$oldshort."
