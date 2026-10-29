#!/usr/bin/env bash
# Takes the baseline of a database: everything in the `public` schema (structure and data) plus the user DIRECTORY (id, email, name),
# which the 59 foreign keys to auth.users need. Passwords, sessions and tokens are NOT taken: people sign in through Auth0 and are linked
# to their carried row by verified email (migration 931). Read-only on the source.
#
#   backend/scripts/baseline-dump.sh <source-connection-url> <output-dir>
#   DOCKER_NETWORK=<net> ...     only when the source is another container (tests)
#
# Output (the directory is created, must not exist): db.dump, auth_users.csv, counts.txt, auth_users.count, SHA256SUMS.
# public.schema_migrations is left out on purpose: the target keeps its own record (npm run db:migrate applies what the baseline lacks).
set -euo pipefail
source_url="${1:?usage: baseline-dump.sh <source-connection-url> <output-dir>}"
out="${2:?usage: baseline-dump.sh <source-connection-url> <output-dir>}"
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
[ ! -e "$out" ] || { echo "refusing: $out already exists"; exit 1; }
mkdir -p "$out"
net=(); [ -z "${DOCKER_NETWORK:-}" ] || net=(--network "$DOCKER_NETWORK")
pg() { docker run --rm -i "${net[@]}" -e SRC="$source_url" "$IMAGE" "$@"; }

echo "dumping the public schema..."
pg sh -c 'pg_dump "$SRC" --schema=public --exclude-table=public.schema_migrations --no-owner --no-privileges --format=custom' > "$out/db.dump"

echo "reading the user directory..."
# Lower-cased emails are what link_identity matches on; a user without an email cannot be linked and is carried only if rows need them.
pg sh -c 'psql "$SRC" -v ON_ERROR_STOP=1 -q -c "\copy (select id, lower(email), coalesce(raw_user_meta_data, '"'"'{}'"'"'::jsonb), created_at from auth.users order by id) to stdout with (format csv)"' > "$out/auth_users.csv"

echo "counting rows..."
pg sh -c 'psql "$SRC" -At -F" " -c "select table_name, (xpath('"'"'/row/c/text()'"'"', query_to_xml(format('"'"'select count(*) as c from %I.%I'"'"', table_schema, table_name), false, true, '"'"''"'"')))[1]::text::bigint from information_schema.tables where table_schema = '"'"'public'"'"' and table_type = '"'"'BASE TABLE'"'"' and table_name <> '"'"'schema_migrations'"'"' order by 1"' > "$out/counts.txt"
pg sh -c 'psql "$SRC" -At -c "select count(*) from auth.users"' > "$out/auth_users.count"

test -s "$out/db.dump" && test -s "$out/counts.txt" || { echo "the dump is empty: nothing written"; exit 1; }
(cd "$out" && shasum -a 256 db.dump auth_users.csv counts.txt auth_users.count > SHA256SUMS)
echo "baseline written to $out: $(wc -l < "$out/counts.txt" | tr -d ' ') tables, $(tr -d ' \n' < "$out/auth_users.count") users"
