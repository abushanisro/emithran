#!/usr/bin/env bash
# Prepares the production database on the VM (run from /opt/emithran after the data tier is up): load the baseline, remove the QA fixtures it
# carries, set the data API's role password. Migrations run afterwards (deploy.sh). Fails closed and is safe to re-run: an already-loaded database
# is left alone.
#
#   BASELINE_DIR=/opt/emithran/baseline [PG_CONTAINER=<name>] [DOCKER_NETWORK=emithran-prd_db] [ENV_FILE=env/prd.env] infra/oracle/production-db.sh
#
# The baseline is schema + the reference/library data (from the stage database); it also carries the two QA organizations, their members and
# users of that database. Those are test fixtures, not people: they are deleted here, but ONLY when everything in those tables is a fixture
# (an email at emithran.test, an organization named "QA ..."): any other row aborts the clean-up so real data is never removed.
# The user DIRECTORY (auth.users) is NOT touched: the baseline carries a placeholder user that owns reference rows (calculators and their
# fields), and deleting it cascades to them (a test run lost 63 calculators and 1,100 fields that way).
set -Eeuo pipefail
trap 'echo "production-db.sh failed at line $LINENO" >&2' ERR
BASELINE_DIR="${BASELINE_DIR:?BASELINE_DIR}"
net="${DOCKER_NETWORK:-emithran-prd_db}"
env_file="${ENV_FILE:-env/prd.env}"
pg="${PG_CONTAINER:-$(docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file "$env_file" ps -q postgres)}"
[ -n "$pg" ] || { echo "no postgres container" >&2; exit 2; }
set -a
# the env file is chosen at run time
# shellcheck source=/dev/null
. "$env_file"
set +a
psql_() { docker exec -i "$pg" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }

if [ "$(psql_ -Atc "select to_regclass('public.organizations') is not null")" = "t" ]; then
  echo "baseline already loaded: leaving the database as it is"
else
  echo "loading the baseline..."
  DOCKER_NETWORK="$net" backend/scripts/baseline-load.sh "$BASELINE_DIR" "postgres://postgres:$(enc "$POSTGRES_PASSWORD")@postgres:5432/postgres"
fi

echo "removing the QA fixtures (only if everything there is a fixture)..."
psql_ -1 <<'S'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.authorized_users WHERE email NOT LIKE '%@emithran.test') THEN RAISE EXCEPTION 'authorized_users holds a non-fixture row: refusing to clean up'; END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE name NOT LIKE 'QA %') THEN RAISE EXCEPTION 'organizations holds a non-fixture row: refusing to clean up'; END IF;
  DELETE FROM public.organization_members;
  DELETE FROM public.authorized_users;
  DELETE FROM public.organizations;
END $$;
S

echo "setting the data API role password..."
psql_ -c "ALTER ROLE authenticator WITH LOGIN PASSWORD '$(printf '%s' "$AUTHENTICATOR_PASSWORD" | sed "s/'/''/g")'" >/dev/null
echo "database ready: $(psql_ -Atc 'select count(*) from public.organizations') organizations, $(psql_ -Atc 'select count(*) from public.calculators') calculators"
