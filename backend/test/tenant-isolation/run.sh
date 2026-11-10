#!/usr/bin/env bash
# Tenant isolation against the REAL schema: builds a throwaway Postgres exactly like production (the baseline plus every migration), runs isolation.sql
# against it, removes it. A release gate, run by hand: the baseline carries the licensed reference data, so it cannot run in CI.
#
#   BASELINE_DIR=~/emithran-baseline backend/test/tenant-isolation/run.sh
#
# Nothing here touches stage or production: its own compose project, its own volume, a port of its own, removed on exit.
set -Eeuo pipefail
trap 'echo "tenant-isolation/run.sh failed at line $LINENO" >&2' ERR
: "${BASELINE_DIR:?set BASELINE_DIR (the baseline directory, e.g. ~/emithran-baseline)}"
cd "$(git rev-parse --show-toplevel)"
proj="isotest$$"; port=$((54000 + RANDOM % 900)); work="$(mktemp -d)"; chmod 700 "$work"
dc() { docker compose -p "$proj" -f docker-compose.prod.yml -f docker-compose.data.yml --env-file "$work/env" "$@"; }
cleanup() { dc down -v >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

# An env file with throwaway values: compose needs every required variable even to start one service.
python3 - "$work/env" "$port" <<'PY'
import sys,secrets,urllib.parse
out,port=sys.argv[1],sys.argv[2]
ex=[l.split('=',1)[0] for l in open('env/prd.env.example') if '=' in l and not l.lstrip().startswith('#')]
pw=secrets.token_hex(12)
vals={k:'throwaway' for k in ex}
vals.update({'POSTGRES_PASSWORD':pw,'AUTHENTICATOR_PASSWORD':secrets.token_hex(12),'PG_PORT':port,'APP_ENV':'prd',
  'MIGRATE_DATABASE_URL':f'postgresql://postgres:{urllib.parse.quote(pw,safe="")}@127.0.0.1:{port}/postgres'})
open(out,'w').write('\n'.join(f'{k}={v}' for k,v in vals.items())+'\n')
PY
chmod 600 "$work/env"

dc up -d postgres >/dev/null
for _ in $(seq 1 60); do dc exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
pg="$(dc ps -q postgres)"
echo "[1/3] baseline"
ENV_FILE="$work/env" DROP_DANGLING=1 BASELINE_DIR="$BASELINE_DIR" PG_CONTAINER="$pg" DOCKER_NETWORK="${proj}_db" bash infra/oracle/production-db.sh | grep -E "database ready" 
echo "[2/3] migrations"
( cd backend && npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env prd --env-file "$work/env" --confirm | tail -1 )
echo "[3/3] isolation checks"
docker exec -i "$pg" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 < backend/test/tenant-isolation/isolation.sql | grep -E "FAIL|checks,"
