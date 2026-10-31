#!/usr/bin/env bash
# Development data on this machine, with no Supabase. Needs Docker Desktop.
#
#   npm run local:up                      start Postgres and the file store
#   npm run local:load -- <baseline-dir>  load a baseline, apply the newer migrations, create the bucket, start the data API
#   npm run local:use                     point the root .env at this stack (the old .env is saved outside the repo; `local:restore` brings it back)
#   npm run local:status | local:down | local:reset -- --yes
#
# A baseline comes from the stage (or old) project:  backend/scripts/baseline-dump.sh "<read-only connection url>" ~/baseline-stage
# Login is Auth0 (the web app has no other sign-in).
# Once it exists:  npm run auth0:check  and then follow docs/CUTOVER_AUTH0_POSTGRES.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
envfile="${LOCAL_ENV_FILE:-$root/.env}"
pg_port="${LOCAL_PG_PORT:-54322}"; api_port="${LOCAL_API_PORT:-3001}"; s3_port="${LOCAL_S3_PORT:-8333}"
compose() { docker compose -f "$root/docker-compose.local-data.yml" "$@"; }

env_get() { [ -f "$envfile" ] && grep -E "^$1=" "$envfile" | tail -1 | cut -d= -f2- || true; }
env_set() { # KEY VALUE: replace the line, or append it
  python3 - "$envfile" "$1" "$2" <<'PY'
import sys, re
path, key, value = sys.argv[1:4]
lines = open(path).read().split('\n') if __import__('os').path.exists(path) else []
done = False
for i, l in enumerate(lines):
    if re.match(rf'^{re.escape(key)}=', l):
        lines[i] = f'{key}={value}'; done = True
if not done:
    if lines and lines[-1] == '': lines.pop()
    lines.append(f'{key}={value}')
open(path, 'w').write('\n'.join(lines).rstrip('\n') + '\n')
PY
}

ensure_secret() { # the one secret the data API trusts; created once, kept in .env
  if [ -z "$(env_get DB_JWT_SECRET)" ]; then env_set DB_JWT_SECRET "$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"; echo "created DB_JWT_SECRET in $envfile"; fi
  DB_JWT_SECRET="$(env_get DB_JWT_SECRET)"; export DB_JWT_SECRET
}
wait_for() { # description, command...
  local what="$1"; shift
  for _ in $(seq 1 60); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timed out waiting for $what"; return 1
}
psql_local() { docker exec -i "$(compose ps -q postgres)" psql -U postgres -v ON_ERROR_STOP=1 -At -q "$@"; }

cmd_up() {
  ensure_secret
  compose up -d postgres storage
  wait_for "Postgres" docker exec "$(compose ps -q postgres)" pg_isready -U postgres
  echo "Postgres on 127.0.0.1:$pg_port, files on 127.0.0.1:$s3_port"
}

cmd_load() {
  local dir="${1:?usage: local:load -- <baseline-dir>}"
  cmd_up
  bash "$here/baseline-load.sh" "$dir" "postgres://postgres:postgres@host.docker.internal:$pg_port/postgres"
  psql_local -c "ALTER ROLE authenticator WITH LOGIN PASSWORD 'authpw'" >/dev/null
  echo "applying migrations newer than the baseline..."
  (cd "$here/.." && MIGRATE_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$pg_port/postgres" npm run -s db:migrate -- --env local)
  (cd "$here/.." && S3_REGION=us-east-1 S3_ENDPOINT="http://127.0.0.1:$s3_port" S3_FORCE_PATH_STYLE=true S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=testtesttest S3_BUCKET=emithran npx ts-node scripts/local-bucket.ts)
  compose --profile api up -d postgrest
  wait_for "the data API" curl -fsS -m 2 "http://127.0.0.1:$api_port/"
  echo "data API on http://127.0.0.1:$api_port. Next: npm run local:use"
}

cmd_use() {
  ensure_secret
  local backup="${LOCAL_BACKUP_DIR:-$HOME}/emithran-env-backup-local-data-$(date +%Y%m%d-%H%M%S)"
  [ -f "$envfile" ] && cp "$envfile" "$backup" && chmod 600 "$backup" && echo "saved the current .env to $backup (restore: npm run local:restore)"
  env_set POSTGREST_URL "http://127.0.0.1:$api_port"
  env_set S3_BUCKET emithran
  env_set S3_REGION us-east-1
  env_set S3_ENDPOINT "http://127.0.0.1:$s3_port"
  env_set S3_FORCE_PATH_STYLE true
  env_set S3_ACCESS_KEY_ID test
  env_set S3_SECRET_ACCESS_KEY testtesttest
  env_set TRUSTED_STORAGE_HOSTS 127.0.0.1
  env_set ALLOW_DEV_AUTH_BYPASS true
  [ -n "$(env_get ADMIN_FALLBACK_EMAIL)" ] || echo "NOTE: set ADMIN_FALLBACK_EMAIL in .env to a user that exists in the loaded baseline (the dev account)."
  echo "root .env now uses local Postgres and local files. Restart the backend and the frontend."
}

cmd_restore() {
  local latest; latest="$(ls -1t "${LOCAL_BACKUP_DIR:-$HOME}"/emithran-env-backup-local-data-* 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] || { echo "no saved .env found"; exit 1; }
  cp "$latest" "$envfile" && echo "restored $envfile from $latest"
}

case "${1:-}" in
  up) cmd_up ;;
  load) shift; cmd_load "$@" ;;
  use) cmd_use ;;
  restore) cmd_restore ;;
  status) compose ps ;;
  down) compose --profile api down ;;
  reset) [ "${2:-}" = "--yes" ] || { echo "this deletes the local database and files: add --yes"; exit 1; }; compose --profile api down -v ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
