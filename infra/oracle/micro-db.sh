#!/usr/bin/env bash
# Copies the production database from the machine that serves it now (the Mac's container) into Postgres on the app server, then PROVES the copy:
# every table's row count is compared with the source. Run it for a rehearsal (the site keeps running from the source), and again at cutover
# after the source's writers are stopped (RESET=1 starts from an empty database both times, so a re-run never doubles rows).
#
#   APP_HOST=<ip> [SOURCE_CONTAINER=emithran-prd-postgres-1] [RESET=1] infra/oracle/micro-db.sh
#
# Roles come first (pg_dumpall --globals-only: the data API's roles and their password hashes), then the database. Nothing is written to the source.
set -Eeuo pipefail
trap 'echo "micro-db.sh failed at line $LINENO" >&2' ERR
: "${APP_HOST:?}"
KEY="${SSH_KEY:-$HOME/.ssh/emithran_prod_ed25519}"; SRC="${SOURCE_CONTAINER:-emithran-prd-postgres-1}"; DST=emithran-prd-postgres-1
ssh_() { ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@$APP_HOST" "$@"; }
dc() { ssh_ "cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f docker-compose.micro-app.yml --env-file env/prd.env $*"; }
count_sql="select table_schema||'.'||table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint from information_schema.tables where table_schema in ('public','auth') and table_type='BASE TABLE' order by 1"

if [ "${RESET:-}" = 1 ]; then
  echo "RESET: emptying the target database (the app server's, never the source)"
  dc "stop backend frontend postgrest cloudflared" || true
  dc "rm -f -s -v postgres" || true
  ssh_ "docker volume rm emithran-prd_pgdata >/dev/null 2>&1 || true"
fi
dc "up -d postgres"
for i in $(seq 1 30); do ssh_ "docker exec $DST pg_isready -h 127.0.0.1 -U postgres" >/dev/null 2>&1 && break; sleep 3; done
if [ "$(ssh_ "docker exec $DST psql -U postgres -d postgres -Atc \"select count(*) from information_schema.tables where table_schema='public'\"")" != 0 ]; then
  echo "the target database is not empty: run with RESET=1 (it only ever empties the app server's copy)" >&2; exit 3
fi
echo "roles ..."; docker exec "$SRC" pg_dumpall -U postgres --globals-only | ssh_ "docker exec -i $DST psql -U postgres -q" 2>&1 | grep -v -E 'already exists|^$' || true
echo "data ...";  docker exec "$SRC" pg_dump -U postgres -d postgres | ssh_ "docker exec -i $DST psql -U postgres -d postgres -q -v ON_ERROR_STOP=1" 2>&1 | grep -v '^$' | head -5 || true
# PostgREST caches the schema when it starts: one that started while the restore was running has no foreign keys yet (they are created last), and
# answers embedded queries with 400 and the backend's database probe with 'query_failed'. Reload it once the data is in.
dc "restart postgrest" >/dev/null 2>&1 || dc "up -d postgrest" >/dev/null
echo "verifying every table's row count ..."
docker exec "$SRC" psql -U postgres -d postgres -At -F , -c "$count_sql" > /tmp/src.counts.$$
ssh_ "docker exec $DST psql -U postgres -d postgres -At -F , -c \"$count_sql\"" > /tmp/dst.counts.$$
if diff -q /tmp/src.counts.$$ /tmp/dst.counts.$$ >/dev/null; then echo "OK: $(wc -l < /tmp/src.counts.$$ | tr -d ' ') tables, $(awk -F, '{s+=$2} END{print s}' /tmp/src.counts.$$) rows, identical to the source"; else echo "MISMATCH:"; diff /tmp/src.counts.$$ /tmp/dst.counts.$$ | head -10; rm -f /tmp/src.counts.$$ /tmp/dst.counts.$$; exit 1; fi
rm -f /tmp/src.counts.$$ /tmp/dst.counts.$$
