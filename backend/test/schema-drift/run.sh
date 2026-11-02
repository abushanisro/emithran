#!/usr/bin/env bash
# scripts/schema-drift.sh on throwaway databases (needs Docker): a "live" database whose schema-only baseline is taken, a migrations
# directory with one migration after that baseline, and the drift check before and after the live database gets the migration, and
# after an object is created outside migrations.
#   npm run test:schema-drift        (from backend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
ID="drift-test-$$"; WORK="$(mktemp -d)"
cleanup() { docker rm -f "$ID-live" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker network create "$ID" >/dev/null
docker run -d --rm --name "$ID-live" --network "$ID" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=pw -v "$PWD/migrations":/migrations:ro "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-live" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
sql() { docker exec -i "$ID-live" psql -U postgres -v ON_ERROR_STOP=1 -q; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (wanted '$2', got '$3')"; fail=1; fi; }

sql <<'SQL'
\i /migrations/930_postgres_compat.sql
CREATE TABLE public.parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
-- The read-only role the nightly check uses (docs/runbooks/schema-drift.md).
CREATE ROLE schema_reader LOGIN PASSWORD 'readerpw';
ALTER ROLE schema_reader SET default_transaction_read_only = on;
GRANT pg_read_all_data TO schema_reader;
SQL
live_admin="postgres://postgres:pw@$ID-live:5432/postgres"
live_reader="postgres://schema_reader:readerpw@$ID-live:5432/postgres"
DOCKER_NETWORK="$ID" bash scripts/baseline-dump.sh --schema-only "$live_admin" "$WORK/baseline" >/dev/null

mkdir "$WORK/migrations"
echo '{ "upToNumber": 917, "alsoIncluded": [] }' > "$WORK/migrations/BASELINE.json"
cat > "$WORK/migrations/960_part_notes.sql" <<'SQL'
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS notes text;
SQL
# The read-only role reaches the live database over the test network, as the CI job reaches production over the internet.
drift() { set +e; MIGRATIONS_DIR="$WORK/migrations" DOCKER_NETWORK="$ID" bash scripts/schema-drift.sh "$WORK/baseline" "$live_reader" "$WORK/out.diff" > "$WORK/out.txt" 2>&1; echo $?; set -e; }

check 'a migration on main that the live database lacks is drift' 3 "$(drift)"
grep -q '^-    notes text' "$WORK/out.diff" && echo "ok   the diff names the missing column" || { echo "FAIL the diff names the missing column"; cat "$WORK/out.txt"; fail=1; }

sql <<'SQL'
ALTER TABLE public.parts ADD COLUMN notes text;
SQL
check 'the same schema is not drift' 0 "$(drift)"

sql <<'SQL'
CREATE FUNCTION public.made_by_hand() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
SQL
check 'an object created outside migrations is drift' 3 "$(drift)"
grep -q '^+CREATE FUNCTION public.made_by_hand' "$WORK/out.diff" && echo "ok   the diff names it" || { echo "FAIL the diff names it"; cat "$WORK/out.txt"; fail=1; }

ro="$(docker exec -e PGPASSWORD=readerpw "$ID-live" psql -h 127.0.0.1 -U schema_reader -d postgres -At -c "CREATE TABLE public.x (id int)" 2>&1 || true)"
case "$ro" in *"read-only transaction"*) echo "ok   the read-only role cannot write";; *) echo "FAIL the read-only role cannot write ($ro)"; fail=1;; esac
exit $fail
