#!/usr/bin/env bash
# Runs the production stack on THIS Mac until the Oracle VM exists (same compose files, same Cloudflare tunnel; moving to the VM later is a database copy).
#
#   infra/oracle/mac-prod.sh <git-ref>            e.g. infra/oracle/mac-prod.sh v0.1.2
#   DRY_RUN=1 infra/oracle/mac-prod.sh <ref>      checks everything, prints the plan, changes nothing
#   YES=1 ...                                     skip the "type GO" question
#
# It deploys exactly what git holds at <git-ref> (git archive, never your working tree) into ~/emithran-prod-run (PROD_DIR), keeping env/ and backups/.
# Before replacing anything it tags the images now running as good-<sha> (rollback: ROLLBACK.md). The database steps are the tested ones: baseline (once),
# the QA clean-up, the migrations; then the services, then the tunnel connector last, so nothing is reachable until everything is healthy.
# The Mac must stay awake, plugged in and signed in, and Docker Desktop must start at login: this is only as available as the Mac.
set -Eeuo pipefail
trap 'echo "mac-prod.sh failed at line $LINENO" >&2' ERR
ref="${1:?usage: mac-prod.sh <git-ref>}"
repo="$(git rev-parse --show-toplevel)"; cd "$repo"
sha="$(git rev-parse --verify --quiet "$ref^{commit}")" || { echo "unknown git ref: $ref" >&2; exit 2; }
# The release must carry everything this script runs from it. An older release (one that predates the deploy tooling) is refused BEFORE anything is changed.
for f in docker-compose.prod.yml docker-compose.data.yml infra/oracle/production-db.sh backend/scripts/baseline-load.sh backend/scripts/migrate.ts env/prd.env.example; do
  git cat-file -e "$sha:$f" 2>/dev/null || { echo "release $ref (${sha:0:12}) does not contain $f: it predates the deploy tooling. Nothing was changed." >&2; exit 2; }
done
run="${PROD_DIR:-$HOME/emithran-prod-run}"; baseline="${BASELINE_DIR:-$HOME/emithran-baseline}"
case "$run" in */emithran-prod-run) ;; *) echo "PROD_DIR must end in /emithran-prod-run (it is emptied on each release): $run" >&2; exit 2 ;; esac
[ -f "$run/env/prd.env" ] && [ -d "$baseline" ] || { echo "need $run/env/prd.env and the baseline directory $baseline" >&2; exit 2; }
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "Docker is not running" >&2; exit 2; }
services="backend frontend cad-engine ecad-engine"

# Required values must be real: blank or a REPLACE_ placeholder fails (the same rule deploy.sh applies).
python3 - "$run/env/prd.env" <<'PY'
import sys
optional={"ANTHROPIC_API_KEY","OTEL_EXPORTER_OTLP_ENDPOINT","OTEL_EXPORTER_OTLP_METRICS_ENDPOINT","OTEL_TRACES_SAMPLER_ARG","APP_INTERNAL_NETWORK","APP_EDGE_NETWORK","BACKUP_HEARTBEAT_URL"}
def parse(p):
    d={}
    for l in open(p):
        s=l.strip()
        if s and not s.startswith('#') and '=' in s: k,v=s.split('=',1); d[k.strip()]=v.strip()
    return d
ex,pr=parse('env/prd.env.example'),parse(sys.argv[1])
bad=[k for k in ex if k not in optional and not k.startswith(('GRAFANA_','PROM_')) and not pr.get(k)]
ph=[k for k,v in pr.items() if 'REPLACE_' in v]
if bad or ph: sys.exit("env/prd.env: missing "+(", ".join(bad) or "-")+"; placeholders "+(", ".join(ph) or "-"))
PY
old="$(cat "$run/.release-sha" 2>/dev/null || true)"
echo "release : $ref -> ${sha:0:12}   (running now: ${old:0:12}${old:+})"
echo "target  : $run   baseline: $baseline"
echo "plan    : tag current images good-${old:0:8} | export release | build | postgres | database + migrations | services | tunnel last"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN: checks passed, nothing changed."; exit 0; fi
if [ "${YES:-0}" != 1 ]; then read -r -p "Deploy ${sha:0:12} to PRODUCTION on this Mac? Type GO: " a; [ "$a" = GO ] || { echo "not confirmed"; exit 1; }; fi

pd() { docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env "$@"; }
if [ -n "$old" ]; then for s in $services; do docker image inspect "emithran-prd-$s" >/dev/null 2>&1 && docker tag "emithran-prd-$s" "emithran-prd-$s:good-${old:0:8}"; done; fi
find "$run" -mindepth 1 -maxdepth 1 ! -name env ! -name backups ! -name ROLLBACK.md -exec rm -rf {} +
git archive "$sha" | tar -x -C "$run"; echo "$sha" > "$run/.release-sha"
cd "$run"

echo "[1/5] building images (the first build takes a while)"; pd build $services postgrest
echo "[2/5] database"
pd up -d postgres
for _ in $(seq 1 60); do pd exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
DROP_DANGLING=1 BASELINE_DIR="$baseline" bash infra/oracle/production-db.sh
echo "[3/5] migrations (from the release itself, inside a node container on the database network)"
python3 - "$run" <<'PY'
import sys,urllib.parse
run=sys.argv[1]; d={}
for l in open(run+'/env/prd.env'):
    if '=' in l and not l.startswith('#'): k,v=l.rstrip('\n').split('=',1); d[k]=v
d['MIGRATE_DATABASE_URL']='postgresql://postgres:%s@postgres:5432/postgres'%urllib.parse.quote(d['POSTGRES_PASSWORD'],safe='')
open(run+'/.migrate.env','w').write('\n'.join(f'{k}={v}' for k,v in d.items())+'\n')
PY
chmod 600 .migrate.env
docker run --rm --network emithran-prd_db -v "$run:/work" -w /work/backend node:24 sh -c 'npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 && npx ts-node -r tsconfig-paths/register scripts/migrate.ts --env prd --env-file /work/.migrate.env --confirm' | tail -2
rm -f .migrate.env
echo "[4/5] services (the tunnel connector is NOT started yet)"
pd up -d backend frontend cad-engine ecad-engine postgrest
for s in backend frontend cad-engine ecad-engine postgrest; do
  st=starting; for _ in $(seq 1 100); do st="$(docker inspect -f '{{.State.Health.Status}}' "emithran-prd-$s-1" 2>/dev/null || echo missing)"; [ "$st" = healthy ] && break; sleep 3; done
  echo "  $s: $st"; [ "$st" = healthy ] || { echo "$s is not healthy: the tunnel stays off. Look: docker logs emithran-prd-$s-1" >&2; exit 1; }
done
ready="$(docker exec emithran-prd-backend-1 node -e "fetch('http://backend:4000/api/health/ready').then(r=>console.log(r.status))" 2>/dev/null || echo down)"
[ "$ready" = 200 ] || { echo "backend readiness is $ready: the tunnel stays off" >&2; exit 1; }
echo "[5/5] tunnel connector (this is the moment app.emithran.com starts answering)"
pd up -d cloudflared
echo "released ${sha:0:12}. readiness 200, tunnel started."
echo "keep the Mac awake:  nohup caffeinate -dimsu >/dev/null 2>&1 &   (stop it with: pkill caffeinate)"
