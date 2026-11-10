#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 (arm64) VM to run the production stack. Run ON the VM as root: sudo bash bootstrap-host.sh
#
# What and why:
#  - SSH: keys only, no root login (a password or root login on a public address is attacked within minutes). fail2ban bans repeat offenders.
#  - Security updates install themselves (unattended-upgrades): the CAD engine parses untrusted files, so the host must not fall behind.
#  - No host firewall layer: the cloud security list already allows only SSH, and Docker publishes no port (the Cloudflare tunnel connects OUT).
#  - Docker (official repo) with log rotation: unbounded container logs fill the disk and stop Postgres.
#  - 4 GB swap: a memory spike (a large STEP file) becomes slow instead of killing Postgres.
#  - Keep-alive: Oracle reclaims an Always Free VM that stays under 20% CPU/network/memory for 7 days. A nice-19 one-core burst for 4 minutes
#    an hour keeps the 95th-percentile CPU above that line; it yields to every real process, so it costs the application nothing.
set -Eeuo pipefail
trap 'echo "bootstrap-host.sh failed at line $LINENO" >&2' ERR
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg unattended-upgrades fail2ban >/dev/null

cat > /etc/ssh/sshd_config.d/99-emithran.conf <<'S'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
S
sshd -t && systemctl reload ssh
systemctl enable --now fail2ban >/dev/null

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'S'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
S

if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
cat > /etc/docker/daemon.json <<'S'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
S
systemctl enable docker >/dev/null && systemctl restart docker
usermod -aG docker ubuntu

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat > /etc/systemd/system/keepalive.service <<'S'
[Unit]
Description=Short low-priority CPU burst so Oracle does not reclaim an idle Always Free VM
[Service]
Type=oneshot
Nice=19
ExecStart=/usr/bin/timeout 240 /bin/sh -c 'while :; do :; done'
SuccessExitStatus=124
S
cat > /etc/systemd/system/keepalive.timer <<'S'
[Unit]
Description=Hourly keep-alive burst
[Timer]
OnCalendar=hourly
Persistent=false
[Install]
WantedBy=timers.target
S
systemctl daemon-reload && systemctl enable --now keepalive.timer >/dev/null
mkdir -p /opt/emithran && chown ubuntu:ubuntu /opt/emithran
echo "host ready: $(docker --version | cut -d, -f1); swap $(swapon --show --noheadings | awk '{print $3}'); ssh password login: off"
