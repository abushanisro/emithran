#!/usr/bin/env bash
# Deploys the production stack to the Oracle VM from your Mac.
#
#   infra/oracle/deploy.sh <vm-public-ip> <git-ref> [<baseline-dir>]      e.g. infra/oracle/deploy.sh 203.0.113.7 v0.1.2
#
# Ships exactly what git has at <git-ref> (git archive, never your working tree), env/prd.env, and the baseline; then on the VM: host setup
# (once), data tier, database (infra/oracle/production-db.sh), migrations, application, monitoring, and the nightly backup timer. Needs the key made for
# this (~/.ssh/emithran_prod_ed25519). Refuses to run when env/prd.env has blank required values. Re-runnable: each step skips what is done.
set -Eeuo pipefail
trap 'echo "deploy.sh failed at line $LINENO" >&2' ERR
ip="${1:?usage: deploy.sh <vm-ip> <git-ref> [<baseline-dir>]}"; ref="${2:?git ref}"; baseline="${3:-$HOME/emithran-baseline}"
repo="$(git rev-parse --show-toplevel)"; cd "$repo"
key="$HOME/.ssh/emithran_prod_ed25519"
ssh_=(ssh -i "$key" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "ubuntu@$ip")
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || { echo "unknown git ref: $ref" >&2; exit 2; }
[ -f env/prd.env ] && [ -d "$baseline" ] || { echo "need env/prd.env and the baseline dir ($baseline)" >&2; exit 2; }

# Required values must be filled; optional ones (monitoring, AI, network names) may stay blank.
python3 - <<'PY'
import sys
optional={"ANTHROPIC_API_KEY","OTEL_EXPORTER_OTLP_ENDPOINT","OTEL_EXPORTER_OTLP_METRICS_ENDPOINT","OTEL_TRACES_SAMPLER_ARG","APP_INTERNAL_NETWORK","APP_EDGE_NETWORK"}
def parse(p):
    d={}
    for l in open(p):
        s=l.strip()
        if s and not s.startswith('#') and '=' in s: k,v=s.split('=',1); d[k.strip()]=v.strip()
    return d
ex,pr=parse('env/prd.env.example'),parse('env/prd.env')
bad=[k for k in ex if k not in optional and not k.startswith(('GRAFANA_','PROM_')) and not pr.get(k)]
if bad: sys.exit("env/prd.env is missing: "+", ".join(bad))
# A value that is still the example's placeholder counts as missing (REPLACE_ME, REPLACE_APP_HOST ...): it passes a "not blank" test and breaks at runtime.
ph=[k for k,v in pr.items() if "REPLACE_" in v]
if ph: sys.exit("env/prd.env still holds placeholders: "+", ".join(ph))
PY

echo "[1/7] host setup"
"${ssh_[@]}" 'command -v docker >/dev/null && test -f /etc/ssh/sshd_config.d/99-emithran.conf' 2>/dev/null \
  || "${ssh_[@]}" 'sudo bash -s' < infra/oracle/bootstrap-host.sh

echo "[2/7] shipping $ref"
git archive "$ref" | "${ssh_[@]}" 'mkdir -p /opt/emithran && tar -x -C /opt/emithran'
"${ssh_[@]}" 'mkdir -p /opt/emithran/env /opt/emithran/baseline'
tar -C "$baseline" -cf - . | "${ssh_[@]}" 'tar -x -C /opt/emithran/baseline'
"${ssh_[@]}" 'umask 077; cat > /opt/emithran/env/prd.env' < env/prd.env

echo "[3/7] data tier"
"${ssh_[@]}" 'cd /opt/emithran && P="docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env" && $P up -d postgres \
  && for i in $(seq 1 60); do $P exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && exit 0; sleep 2; done; echo "postgres did not become ready" >&2; exit 1'

echo "[4/7] database (baseline, clean-up, role) and migrations"
"${ssh_[@]}" 'cd /opt/emithran && DROP_DANGLING=1 BASELINE_DIR=/opt/emithran/baseline bash infra/oracle/production-db.sh'
"${ssh_[@]}" 'cd /opt/emithran/backend && docker run --rm --network host -v /opt/emithran:/work -w /work/backend node:24 sh -c "npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null && npm run db:migrate -- --env prd --confirm"'

echo "[5/7] application (builds the images on the VM: several minutes the first time; no `storage` service: files go to R2)"
"${ssh_[@]}" 'cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env up -d --build postgres postgrest backend frontend cad-engine ecad-engine cloudflared'

echo "[6/7] monitoring (Prometheus, Grafana, probes, host metrics): the app keeps running if this stack is down"
"${ssh_[@]}" 'cd /opt/emithran && docker compose -p emithran-prd-mon -f docker-compose.monitoring.yml --env-file env/prd.env --profile host-metrics up -d'

echo "[7/7] nightly backup timer"
"${ssh_[@]}" 'sudo tee /etc/systemd/system/emithran-backup.service >/dev/null <<S
[Unit]
Description=Emithran database backup to R2
[Service]
Type=oneshot
User=ubuntu
ExecStart=/bin/bash /opt/emithran/infra/oracle/backup.sh
S
sudo tee /etc/systemd/system/emithran-backup.timer >/dev/null <<S
[Unit]
Description=Nightly Emithran backup
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
S
sudo systemctl daemon-reload && sudo systemctl enable --now emithran-backup.timer >/dev/null'

echo "deployed $ref to $ip. Check: ssh ubuntu@$ip 'docker ps --format \"{{.Names}} {{.Status}}\"'"
