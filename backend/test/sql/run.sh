#!/usr/bin/env bash
# Runs every test/sql/*.test.sql against a throwaway Postgres in Docker: a fresh database per test, minimal stand-ins for the
# Supabase pieces (test/sql/00_stubs.sql), then the migrations under test, then the test's own ASSERTs. No port is published
# and nothing outside the container is touched.
#   npm run test:sql              all tests
#   npm run test:sql -- retention one test
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
MIGRATIONS=(917_cad_uploads 918_free_tier_housekeeping 919_audit_events 920_job_queue)
NAME="sqltest-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test --tmpfs /var/lib/postgresql/data "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

failed=0
for test in ${1:+$1.test.sql} ${1:-*.test.sql}; do
  [ -f "$test" ] || continue
  db="t_${test%.test.sql}"
  psql -d postgres -c "CREATE DATABASE $db" >/dev/null
  psql -d "$db" < 00_stubs.sql >/dev/null
  # A migration that does not apply is a failure of its own, never skipped: only a file that does not exist yet is passed over.
  for m in "${MIGRATIONS[@]}"; do
    [ -f "../../migrations/$m.sql" ] || continue
    psql -d "$db" < "../../migrations/$m.sql" >/dev/null
  done
  if psql -d "$db" < "$test" 2>/tmp/sqltest-$$.err; then echo "  ok   $test"; else echo "  FAIL $test"; sed 's/^/       /' /tmp/sqltest-$$.err; failed=1; fi
done
exit $failed
