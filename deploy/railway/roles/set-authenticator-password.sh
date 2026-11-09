#!/bin/sh
# One-off: sets the login password of the `authenticator` role, the role PostgREST connects as. The password arrives in AUTH_PW and reaches
# the server as a psql variable, quoted as a literal by psql itself (never spliced into the statement text by the shell).
set -eu
[ -n "${AUTH_PW:-}" ] || { echo "AUTH_PW is not set" >&2; exit 1; }
[ -n "${TARGET_URL:-}" ] || { echo "TARGET_URL is not set" >&2; exit 1; }
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -v pw="$AUTH_PW" -q <<'SQL'
ALTER ROLE authenticator WITH LOGIN PASSWORD :'pw';
SQL
psql "$TARGET_URL" -At -c "select 'authenticator can log in: ' || rolcanlogin from pg_roles where rolname = 'authenticator'"
echo "authenticator password set"
