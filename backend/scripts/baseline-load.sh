#!/usr/bin/env bash
# Loads a baseline (from baseline-dump.sh) into a NEW, EMPTY Postgres, then proves every row arrived.
#
#   backend/scripts/baseline-load.sh <baseline-dir> <target-connection-url>
#   DOCKER_NETWORK=<net> ...     only when the target is another container (tests)
#
# Order: checksums, target must hold no tables, migration 930 (roles, auth schema, auth.uid()), the user directory, the public schema,
# then every table's row count against counts.txt. Afterwards run `npm run db:migrate` for the migrations newer than the baseline.
# It never wipes anything: a target that already has tables is refused, not emptied.
set -euo pipefail
dir="${1:?usage: baseline-load.sh <baseline-dir> <target-connection-url>}"
target="${2:?usage: baseline-load.sh <baseline-dir> <target-connection-url>}"
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
here="$(cd "$(dirname "$0")" && pwd)"
dir="$(cd "$dir" && pwd)"
net=(); [ -z "${DOCKER_NETWORK:-}" ] || net=(--network "$DOCKER_NETWORK")
pg() { docker run --rm -i --add-host host.docker.internal:host-gateway ${net[@]+"${net[@]}"} -e TARGET="$target" -v "$dir":/baseline:ro -v "$here/../migrations":/migrations:ro "$IMAGE" "$@"; }

(cd "$dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || { echo "refusing: the baseline files do not match SHA256SUMS"; exit 1; }
existing="$(pg sh -c 'psql "$TARGET" -At -c "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"')"
[ "$existing" = "0" ] || { echo "refusing: the target already has $existing table(s) in public. Load into an empty database."; exit 1; }

echo "migration 930 (roles, auth schema)..."
pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -f /migrations/930_postgres_compat.sql' >/dev/null
echo "user directory..."
pg sh -c 'psql "$TARGET" -v ON_ERROR_STOP=1 -q -c "\copy auth.users (id, email, raw_user_meta_data, created_at) from /baseline/auth_users.csv with (format csv)"'
echo "public schema..."
# Every database already has a `public` schema, so its CREATE/COMMENT entries are left out of the restore; anything else that fails stops the load.
pg sh -c 'pg_restore -l /baseline/db.dump | grep -v " SCHEMA - public " > /tmp/restore.list; pg_restore --dbname="$TARGET" --use-list=/tmp/restore.list --no-owner --no-privileges --exit-on-error /baseline/db.dump'

echo "checking row counts..."
pg sh -c 'psql "$TARGET" -At -F" " -c "select table_name, (xpath('"'"'/row/c/text()'"'"', query_to_xml(format('"'"'select count(*) as c from %I.%I'"'"', table_schema, table_name), false, true, '"'"''"'"')))[1]::text::bigint from information_schema.tables where table_schema = '"'"'public'"'"' and table_type = '"'"'BASE TABLE'"'"' and table_name <> '"'"'schema_migrations'"'"' order by 1"' > "$dir/.restored.txt"
trap 'rm -f "$dir/.restored.txt"' EXIT
diff "$dir/counts.txt" "$dir/.restored.txt" > /dev/null || { echo "FAILED: row counts differ (baseline < loaded >)"; diff "$dir/counts.txt" "$dir/.restored.txt" || true; exit 1; }
users="$(pg sh -c 'psql "$TARGET" -At -c "select count(*) from auth.users"')"
[ "$users" = "$(tr -d ' \n' < "$dir/auth_users.count")" ] || { echo "FAILED: $users users loaded, baseline has $(cat "$dir/auth_users.count")"; exit 1; }
echo "baseline loaded: $(wc -l < "$dir/counts.txt" | tr -d ' ') tables and $users users, every count matches. Next: npm run db:migrate"
