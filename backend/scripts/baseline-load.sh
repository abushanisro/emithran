#!/usr/bin/env bash
# Loads a baseline (from baseline-dump.sh) into a NEW, EMPTY Postgres, then proves every row arrived.
#
#   backend/scripts/baseline-load.sh <baseline-dir> <target-connection-url>
#   DOCKER_NETWORK=<net> ...     only when the target is another container (tests)
#
# Order: checksums, target must hold no tables, migration 930 (roles, auth schema, auth.uid()), the extensions schema, the user directory, the public schema,
# the foreign keys (rows with no parent stop the load unless DROP_DANGLING=1), then every table's row count against counts.txt. Afterwards run `npm run db:migrate` for the migrations newer than the baseline.
# It never wipes anything: a target that already has tables is refused, not emptied.
set -euo pipefail
dir="${1:?usage: baseline-load.sh <baseline-dir> <target-connection-url>}"
target="${2:?usage: baseline-load.sh <baseline-dir> <target-connection-url>}"
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$(cd "$dir" && pwd)"
net=(); [ -z "${DOCKER_NETWORK:-}" ] || net=(--network "$DOCKER_NETWORK")
work="$(mktemp -d)"
trap 'rm -rf "$work"; rm -f "$dir/.restored.txt"' EXIT
pg() { docker run --rm -i --add-host host.docker.internal:host-gateway ${net[@]+"${net[@]}"} -e TARGET="$target" -v "$dir":/baseline:ro -v "$here/../migrations":/migrations:ro -v "$work":/work "$IMAGE" "$@"; }

(cd "$dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || { echo "refusing: the baseline files do not match SHA256SUMS"; exit 1; }
existing="$(pg sh -c 'psql "$TARGET" -At -c "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"')"
[ "$existing" = "0" ] || { echo "refusing: the target already has $existing table(s) in public. Load into an empty database."; exit 1; }

echo "migration 930 (roles, auth schema)..."
pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -f /migrations/930_postgres_compat.sql' >/dev/null
# A Supabase dump expects Supabase's extensions to exist, but a public-schema dump does not carry them: uuid-ossp and pgcrypto in an
# `extensions` schema on the search path (tables default to extensions.uuid_generate_v4(), some functions call digest() unqualified),
# and pg_trgm in public (a GIN index uses public.gin_trgm_ops). Give a plain Postgres the same.
echo "extensions schema (Supabase layout)..."
pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q' <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- Migration 930 stopped PUBLIC executing new functions, so the API roles get these the way Supabase grants them; without it, every
-- insert that relies on a uuid_generate_v4() default fails for a signed-in user.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;
-- pg_trgm was created in public on Supabase, so the dump names its operator class public.gin_trgm_ops.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = "$user", public, extensions', current_database()); END $$;
SQL
echo "user directory..."
pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -c "\copy auth.users (id, email, raw_user_meta_data, created_at) from /baseline/auth_users.csv with (format csv)"'
echo "public schema..."
# Every database already has a `public` schema, so its CREATE/COMMENT entries are left out of the restore. So is the one foreign key into
# Supabase's own auth.sessions, which a plain Postgres does not have (migration 901 skips it the same way; sessions are not carried).
# Anything else that fails stops the load.
pg sh -c 'pg_restore -l /baseline/db.dump | grep -v -e " SCHEMA - public " -e " FK CONSTRAINT public user_session_activity user_session_activity_session_id_fkey " > /work/restore.list; grep -v -e " FK CONSTRAINT " -e " COMMENT public CONSTRAINT " /work/restore.list > /work/data.list; pg_restore --dbname="$TARGET" --use-list=/work/data.list --no-owner --no-privileges --exit-on-error /baseline/db.dump'

# Foreign keys last, added NOT VALID so the rows one would reject can be found and named. A database that was not enforcing its keys
# (rows left behind when a parent was deleted) cannot be loaded as it is: by default the load stops and lists them. With DROP_DANGLING=1
# each such row is first written to <baseline-dir>.dangling/<table>.csv and then removed, so nothing is lost silently.
echo "foreign keys..."
pg sh -c 'grep -e " FK CONSTRAINT " -e " COMMENT public CONSTRAINT " /work/restore.list > /work/fk.list; pg_restore --use-list=/work/fk.list --no-owner --no-privileges -f - /baseline/db.dump | sed "/FOREIGN KEY/ s/;\$/ NOT VALID;/" > /work/fk.sql'
add_keys() { pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -f /work/fk.sql' >/dev/null; }
# a key, even an unvalidated one, refuses the deletion of a row that other rows still point to: take them off while rows are removed
drop_keys() { pg sh -c 'psql "$TARGET" -At -v ON_ERROR_STOP=1 -q -c "select format(\$\$ALTER TABLE %s DROP CONSTRAINT %I;\$\$, conrelid::regclass, conname) from pg_constraint where contype = \$\$f\$\$ and not convalidated and connamespace = \$\$public\$\$::regnamespace" | psql "$TARGET" -v ON_ERROR_STOP=1 -q' >/dev/null; }
cat > "$work/cond.sql" <<'SQL'
-- the rows of constraint k's table that have no parent row: every key column is set and no parent matches
CREATE FUNCTION pg_temp.cond(k pg_constraint) RETURNS text LANGUAGE sql AS $f$
  SELECT format('%s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
                string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ' ORDER BY u.i),
                k.confrelid::regclass,
                string_agg(format('p.%I = c.%I', pa.attname, a.attname), ' AND ' ORDER BY u.i))
  FROM unnest(k.conkey, k.confkey) WITH ORDINALITY u(ck, pk, i)
  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.ck
  JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = u.pk
$f$;
SQL
dangling() { # prints: child | constraint | number of rows without a parent | condition, for each unvalidated key that has some
  pg sh -c 'psql "$TARGET" -At -F"|" -v ON_ERROR_STOP=1 -q -f /work/cond.sql -c "
    SELECT * FROM (SELECT k.conrelid::regclass::text AS child, k.conname AS name,
      (xpath(\$\$/row/c/text()\$\$, query_to_xml(format(\$\$SELECT count(*) AS c FROM %s c WHERE %s\$\$, k.conrelid::regclass, pg_temp.cond(k)), false, true, \$\$\$\$)))[1]::text::bigint AS n,
      pg_temp.cond(k) AS cond
    FROM pg_constraint k WHERE k.contype = \$\$f\$\$ AND NOT k.convalidated AND k.connamespace = \$\$public\$\$::regnamespace) x WHERE n > 0 ORDER BY 1, 2"'
}
: > "$work/dropped.txt"
add_keys
found="$(dangling)"
if [ -n "$found" ]; then
  echo "rows with no parent row (the old database was not enforcing these keys):"
  echo "$found" | awk -F'|' '{ printf "  %-45s %6d row(s)  (%s)\n", $1, $3, $2 }'
  [ "${DROP_DANGLING:-}" = "1" ] || { echo "refusing to load them. Review the rows, then run again with DROP_DANGLING=1 to set them aside (they are saved to $dir.dangling/) and load the rest. This target is now partly loaded: empty it (drop and recreate the database) before the next run."; exit 1; }
  mkdir -p "$dir.dangling"
  while [ -n "$found" ]; do
    drop_keys
    while IFS='|' read -r child name n cond; do
      table="${child#public.}"
      pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -c "copy (select c.* from '"$child"' c where '"${cond//\"/\\\"}"') to stdout with csv header"' >> "$dir.dangling/$table.csv"
      removed="$(pg sh -c 'psql "$TARGET" -At -v ON_ERROR_STOP=1 -q -c "with d as (delete from '"$child"' c where '"${cond//\"/\\\"}"' returning 1) select count(*) from d"')"
      echo "$table $removed" >> "$work/dropped.txt"
    done <<< "$found"
    add_keys
    found="$(dangling)"   # removing a row can leave the rows that pointed at it without a parent
  done
  echo "set aside rows are in $dir.dangling/"
fi
pg sh -c 'psql "$TARGET" -At -v ON_ERROR_STOP=1 -q -c "select format(\$\$ALTER TABLE %s VALIDATE CONSTRAINT %I;\$\$, conrelid::regclass, conname) from pg_constraint where contype = \$\$f\$\$ and not convalidated and connamespace = \$\$public\$\$::regnamespace" | psql "$TARGET" -v ON_ERROR_STOP=1 -q' >/dev/null

echo "checking row counts..."
pg sh -c 'psql "$TARGET" -At -F" " -c "select table_name, (xpath('"'"'/row/c/text()'"'"', query_to_xml(format('"'"'select count(*) as c from %I.%I'"'"', table_schema, table_name), false, true, '"'"''"'"')))[1]::text::bigint from information_schema.tables where table_schema = '"'"'public'"'"' and table_type = '"'"'BASE TABLE'"'"' and table_name <> '"'"'schema_migrations'"'"' order by 1"' > "$dir/.restored.txt"
awk -v dropped="$work/dropped.txt" 'BEGIN { while ((getline line < dropped) > 0) { split(line, f, " "); gone[f[1]] += f[2] } } { print $1, $2 - gone[$1] }' "$dir/counts.txt" > "$work/expected.txt"
diff "$work/expected.txt" "$dir/.restored.txt" > /dev/null || { echo "FAILED: row counts differ (expected < loaded >)"; diff "$work/expected.txt" "$dir/.restored.txt" || true; exit 1; }
users="$(pg sh -c 'psql "$TARGET" -At -c "select count(*) from auth.users"')"
[ "$users" = "$(tr -d ' \n' < "$dir/auth_users.count")" ] || { echo "FAILED: $users users loaded, baseline has $(cat "$dir/auth_users.count")"; exit 1; }
echo "baseline loaded: $(wc -l < "$dir/counts.txt" | tr -d ' ') tables and $users users, every count matches. Next: npm run db:migrate"
