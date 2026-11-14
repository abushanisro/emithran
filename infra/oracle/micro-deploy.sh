#!/usr/bin/env bash
# Deploys the stack onto TWO small Always Free x86 servers (VM.Standard.E2.1.Micro) from this machine. Idempotent: safe to re-run.
#
#   APP_HOST=<public ip> ENGINE_HOST=<public ip> ENGINE_PRIVATE_IP=<10.x> [IMAGE_PROJECT=emithran-amd64] [ENV_FILE=~/emithran-prod-run/env/prd.env] \
#   infra/oracle/micro-deploy.sh engines | app | status
#
#   engines : the CAD and electronics engines + two loopback forwarders on ENGINE_HOST (docker-compose.micro-engines.yml)
#   app     : Postgres, PostgREST, backend, frontend on APP_HOST (docker-compose.micro-app.yml) and the SSH tunnel to the engines.
#             The tunnel connector (cloudflared) is NOT started here: starting it is the moment the public site moves (see `cutover` in the runbook).
#   status  : what runs where, memory, tunnel and engine reachability.
#
# Images are built here for linux/amd64 (`DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose -p emithran-amd64 ... build`) and streamed over SSH
# (docker save | gzip | ssh docker load): no registry and no access token. They are retagged to the names compose expects (emithran-prd-<service>).
# Secrets: the app server gets the env file; the engine server gets a copy where every secret that is not the engines' own is replaced by "unused".
set -Eeuo pipefail
trap 'echo "micro-deploy.sh failed at line $LINENO" >&2' ERR
mode="${1:?engines | app | status}"
: "${APP_HOST:?}" "${ENGINE_HOST:?}" "${ENGINE_PRIVATE_IP:?}"
KEY="${SSH_KEY:-$HOME/.ssh/emithran_prod_ed25519}"; ENV_FILE="${ENV_FILE:-$HOME/emithran-prod-run/env/prd.env}"; IP="${IMAGE_PROJECT:-emithran-amd64}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ssh_() { local h="$1"; shift; ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ubuntu@$h" "$@"; }
scp_() { scp -i "$KEY" -o BatchMode=yes -q "$@"; }
ship_image() { # <host> <service>
  local h="$1" s="$2"
  docker image inspect "$IP-$s" >/dev/null 2>&1 || { echo "image $IP-$s is not built (build it first)" >&2; exit 2; }
  echo "shipping $s ($(docker image inspect "$IP-$s" --format '{{.Architecture}}'), $(( $(docker image inspect "$IP-$s" --format '{{.Size}}') / 1000000 )) MB) to $h ..."
  docker save "$IP-$s" | gzip -1 | ssh_ "$h" "gunzip | docker load >/dev/null && docker tag $IP-$s emithran-prd-$s:latest && docker image rm $IP-$s >/dev/null 2>&1 || true"
}
dc() { # <host> <overlay> <envfile> <args...>
  local h="$1" o="$2" e="$3"; shift 3
  ssh_ "$h" "cd /opt/emithran && docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml -f $o --env-file $e $*"
}

case "$mode" in
engines)
  ssh_ "$ENGINE_HOST" true
  ssh_ "$ENGINE_HOST" 'sudo mkdir -p /opt/emithran/env && sudo chown -R ubuntu:ubuntu /opt/emithran'
  scp_ "$root/docker-compose.prod.yml" "$root/docker-compose.data.yml" "$root/docker-compose.micro-engines.yml" "ubuntu@$ENGINE_HOST:/opt/emithran/"
  # the engines' env: their own keys kept, every other secret masked (compose still wants every ${VAR:?} to be set)
  python3 - "$ENV_FILE" > /tmp/engines.env.$$ <<'PY'
import re,sys
keep={'CAD_ENGINE_API_KEY','ECAD_ENGINE_API_KEY'}
for line in open(sys.argv[1]):
    m=re.match(r'^([A-Z0-9_]+)=(.*)$',line.rstrip('\n'))
    if not m: continue
    k,v=m.groups()
    secret=re.search(r'(SECRET|PASSWORD|TOKEN|KEY|PRIVATE)',k) and k not in keep
    print(f'{k}={"unused" if secret else v}')
PY
  scp_ /tmp/engines.env.$$ "ubuntu@$ENGINE_HOST:/opt/emithran/env/engines.env"; ssh_ "$ENGINE_HOST" 'chmod 600 /opt/emithran/env/engines.env'; rm -f /tmp/engines.env.$$
  for s in cad-engine ecad-engine; do ship_image "$ENGINE_HOST" "$s"; done
  dc "$ENGINE_HOST" docker-compose.micro-engines.yml env/engines.env up -d --no-build cad-engine ecad-engine cad-proxy ecad-proxy
  echo "engines up on $ENGINE_HOST (loopback 5055, 5100)"
  ;;
app)
  ssh_ "$APP_HOST" true
  ssh_ "$APP_HOST" 'sudo mkdir -p /opt/emithran/env && sudo chown -R ubuntu:ubuntu /opt/emithran'
  scp_ "$root/docker-compose.prod.yml" "$root/docker-compose.data.yml" "$root/docker-compose.micro-app.yml" "ubuntu@$APP_HOST:/opt/emithran/"
  scp_ "$ENV_FILE" "ubuntu@$APP_HOST:/opt/emithran/env/prd.env"; ssh_ "$APP_HOST" 'chmod 600 /opt/emithran/env/prd.env'
  # SSH tunnel to the engine server: a dedicated key that may do nothing but forward two loopback ports
  # Oracle's Ubuntu image rejects every host-bound connection but SSH (REJECT at the end of INPUT): let only Docker's private networks reach the
  # two tunnel ports (the public interface is not in 172.16.0.0/12, and the cloud firewall allows only SSH in any case).
  ssh_ "$APP_HOST" 'sudo iptables -C INPUT -s 172.16.0.0/12 -p tcp -m multiport --dports 5055,5100 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 4 -s 172.16.0.0/12 -p tcp -m multiport --dports 5055,5100 -j ACCEPT; sudo netfilter-persistent save >/dev/null 2>&1'
  ssh_ "$APP_HOST" '[ -f ~/.ssh/engine_tunnel ] || ssh-keygen -q -t ed25519 -N "" -C tunnel@app -f ~/.ssh/engine_tunnel'
  pub="$(ssh_ "$APP_HOST" 'cat ~/.ssh/engine_tunnel.pub')"
  ssh_ "$ENGINE_HOST" "grep -qF '$(printf '%s' "$pub" | cut -d' ' -f2)' ~/.ssh/authorized_keys || echo 'restrict,port-forwarding,permitopen=\"127.0.0.1:5055\",permitopen=\"127.0.0.1:5100\" $pub' >> ~/.ssh/authorized_keys"
  ssh_ "$APP_HOST" "ssh-keyscan -t ed25519 $ENGINE_PRIVATE_IP 2>/dev/null > ~/.ssh/known_hosts_engine"
  ssh_ "$APP_HOST" "sudo tee /etc/systemd/system/engine-tunnel.service >/dev/null <<UNIT
[Unit]
Description=SSH tunnel to the engine server (CAD 5055, electronics 5100) on the Docker bridge
After=docker.service network-online.target
Wants=network-online.target
[Service]
User=ubuntu
ExecStart=/usr/bin/ssh -N -i /home/ubuntu/.ssh/engine_tunnel -o UserKnownHostsFile=/home/ubuntu/.ssh/known_hosts_engine -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 172.17.0.1:5055:127.0.0.1:5055 -L 172.17.0.1:5100:127.0.0.1:5100 ubuntu@$ENGINE_PRIVATE_IP
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now engine-tunnel.service >/dev/null"
  for s in backend frontend; do ship_image "$APP_HOST" "$s"; done
  dc "$APP_HOST" docker-compose.micro-app.yml env/prd.env up -d --no-build postgres
  echo "database up on $APP_HOST (PostgREST is started by micro-db.sh after the data is loaded). Load the database (infra/oracle/micro-db.sh), then start backend and frontend; cloudflared stays stopped until cutover."
  ;;
status)
  for h in "$APP_HOST" "$ENGINE_HOST"; do echo "== $h"; ssh_ "$h" 'free -m | sed -n 2,3p; docker ps --format "{{.Names}} {{.Status}}" | sed "s/emithran-prd-//"; docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" 2>/dev/null | sed "s/emithran-prd-//" | head -8'; done
  echo "== tunnel (app -> engines)"; ssh_ "$APP_HOST" 'systemctl is-active engine-tunnel; docker run --rm --network host curlimages/curl -s -o /dev/null -w "cad engine via tunnel: %{http_code}\n" --max-time 8 http://172.17.0.1:5055/health || true'
  ;;
*) echo "unknown mode $mode" >&2; exit 2 ;;
esac
