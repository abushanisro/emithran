#!/usr/bin/env bash
# Runs every test/sql/*.test.sql against a throwaway Postgres in Docker: a fresh database per test, minimal stand-ins for the
# Supabase pieces (test/sql/00_stubs.sql), then the migrations under test, then the test's own ASSERTs. No port is published
# and nothing outside the container is touched.
#   npm run test:sql              all tests
#   npm run test:sql -- retention one test
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
MIGRATIONS=(917_cad_uploads 918_free_tier_housekeeping 919_audit_events 920_job_queue 921_security_hardening 922_revoke_anon_table_access 923_cad_upload_analysed 930_postgres_compat 931_identity_functions 933_kpi_views)
NAME="sqltest-$$"
trap 'docker rm -f "$NAME" "$NAME-compat" >/dev/null 2>&1 || true' EXIT

start() { # a throwaway Postgres; roles are shared by every database in one, so the tests that need roles of their own get their own
  docker run -d --rm --name "$1" -e POSTGRES_PASSWORD=test --tmpfs /var/lib/postgresql/data -v "$PWD/../../migrations":/migrations:ro "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do docker exec "$1" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
}
start "$NAME"
CT="$NAME"
psql() { docker exec -i "$CT" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

failed=0
for test in ${1:+$1.test.sql} ${1:-*.test.sql}; do
  [ -f "$test" ] || continue
  db="t_${test%.test.sql}"
  # compat_* tests run on a bare database: no Supabase stand-ins, only migration 930, because they prove 930 provides everything
  # (roles, auth schema, uid/role/jwt) by itself. Every other test starts from the stubs and applies all migrations.
  if [[ "$test" == compat_* ]]; then
    CT="$NAME-compat"; docker rm -f "$CT" >/dev/null 2>&1 || true; start "$CT"
    psql -d postgres -c "CREATE DATABASE $db" >/dev/null
    migrations=(930_postgres_compat 931_identity_functions 932_user_directory)
  else
    psql -d postgres -c "CREATE DATABASE $db" >/dev/null
    psql -d "$db" < 00_stubs.sql >/dev/null
    migrations=("${MIGRATIONS[@]}")
  fi
  # A migration that does not apply is a failure of its own, never skipped: only a file that does not exist yet is passed over.
  for m in "${migrations[@]}"; do
    [ -f "../../migrations/$m.sql" ] || continue
    psql -d "$db" < "../../migrations/$m.sql" >/dev/null
  done
  if psql -d "$db" < "$test" 2>/tmp/sqltest-$$.err; then echo "  ok   $test"; else echo "  FAIL $test"; sed 's/^/       /' /tmp/sqltest-$$.err; failed=1; fi
  if [[ "$test" == compat_* ]]; then docker rm -f "$CT" >/dev/null 2>&1 || true; CT="$NAME"; fi
done
exit $failed
