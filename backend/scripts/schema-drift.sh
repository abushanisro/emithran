#!/usr/bin/env bash
# Schema drift: is a live database's `public` schema exactly what main's baseline plus main's migrations build? Read-only on the live
# database (pg_dump --schema-only through a read-only role). Needs Docker and the backend's node_modules.
#
#   backend/scripts/schema-drift.sh <schema-only-baseline-dir> <read-only-connection-url> [<diff-file>]
#   MIGRATIONS_DIR=<dir> ...     another migrations directory (with its BASELINE.json); default backend/migrations
#   DOCKER_NETWORK=<net> ...     only when the live database is another container (tests)
#
# The expected schema: a throwaway Postgres, the schema-only baseline loaded into it (baseline-load.sh), then every later migration
# applied (scripts/migrate.ts, as db:migrate does). Both sides are dumped the same way (public schema, no owners, no grants, without
# schema_migrations) and compared.
#   exit 0  no drift
#   exit 3  drift: the unified diff (- expected, + live) is printed and written to <diff-file>
#   other   the check could not run
# Grants are not compared: the baseline dump carries none (baseline-dump.sh). Runbook: docs/runbooks/schema-drift.md.
set -euo pipefail
baseline="${1:?usage: schema-drift.sh <schema-only-baseline-dir> <read-only-connection-url> [<diff-file>]}"
live="${2:?usage: schema-drift.sh <schema-only-baseline-dir> <read-only-connection-url> [<diff-file>]}"
diff_file="${3:-}"
IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
here="$(cd "$(dirname "$0")" && pwd)"
migrations="$(cd "${MIGRATIONS_DIR:-$here/../migrations}" && pwd)"
[ -f "$baseline/db.dump" ] || { echo "no schema-only baseline at $baseline (expected db.dump from baseline-dump.sh --schema-only)" >&2; exit 2; }

ID="schema-drift-$$"; WORK="$(mktemp -d)"
cleanup() { docker rm -f "$ID-pg" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker network create "$ID" >/dev/null
docker run -d --rm --name "$ID-pg" --network "$ID" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=pw --tmpfs /var/lib/postgresql/data "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-pg" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
port="$(docker port "$ID-pg" 5432/tcp | head -1 | sed 's/.*://')"

echo "expected: baseline + migrations..."
DOCKER_NETWORK="$ID" bash "$here/baseline-load.sh" "$baseline" "postgres://postgres:pw@$ID-pg:5432/postgres" >/dev/null
printf 'MIGRATE_DATABASE_URL=postgres://postgres:pw@127.0.0.1:%s/postgres\n' "$port" > "$WORK/local.env"
(cd "$here/.." && npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env local --env-file "$WORK/local.env" --dir "$migrations" >/dev/null)

# pg_dump 17.6+ writes a random \restrict key into plain dumps, and the version banners differ between servers: neither is schema.
dump() { # <url> <docker network>
  docker run --rm --network "$2" -e SRC="$1" "$IMAGE" sh -c \
    'pg_dump "$SRC" --schema=public --schema-only --no-owner --no-privileges --exclude-table=public.schema_migrations' |
    grep -v -E '^\\(un)?restrict |^-- Dumped (from|by) '
}
dump "postgres://postgres:pw@$ID-pg:5432/postgres" "$ID" > "$WORK/expected.sql"
echo "live: schema only, read-only..."
dump "$live" "${DOCKER_NETWORK:-bridge}" > "$WORK/live.sql"

if diff -u --label expected --label live "$WORK/expected.sql" "$WORK/live.sql" > "$WORK/drift.diff"; then
  echo "no drift: the live schema is what the baseline and migrations build"
  exit 0
fi
[ -z "$diff_file" ] || cp "$WORK/drift.diff" "$diff_file"
cat "$WORK/drift.diff"
echo "DRIFT: the live schema differs from the baseline and migrations (- expected, + live)" >&2
exit 3
