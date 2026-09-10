#!/usr/bin/env bash
# Provision a WSL2 Ubuntu distro as the Docker host for the CAD engine.
#
# Windows 11 Smart App Control blocks pythonocc-core's unsigned .pyd binaries
# (CodeIntegrity 3077) and offers no allowlist, so the engine cannot run
# natively on Windows while SAC is enforcing. This script prepares the Linux
# side so the engine runs from the same image production builds.
#
# Run once, from inside the distro:
#   wsl -d Ubuntu-24.04 -u root bash /mnt/c/.../cad-engine/scripts/provision-wsl-docker.sh
#
# Idempotent: safe to re-run.

set -euo pipefail

DEV_USER="${DEV_USER:-singi}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (wsl -d Ubuntu-24.04 -u root ...)." >&2
  exit 1
fi

log "Configuring /etc/wsl.conf (systemd + drvfs metadata + default user)"
# metadata on /mnt/c is required for sane file ownership on the bind-mounted
# source tree; without it every Windows file appears as 0777 root-owned.
cat > /etc/wsl.conf <<CONF
[boot]
systemd=true

[automount]
enabled=true
options="metadata,umask=22,fmask=11"

[user]
default=${DEV_USER}

[interop]
enabled=true
appendWindowsPath=true
CONF

log "Creating non-root user '${DEV_USER}'"
if ! id -u "${DEV_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${DEV_USER}"
fi
usermod -aG sudo "${DEV_USER}"
# No password is set for this account; sudo is granted passwordless so the
# unattended dev loop never blocks on a prompt. This distro is a local build
# host only and is not network-reachable.
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "${DEV_USER}" > "/etc/sudoers.d/90-${DEV_USER}"
chmod 0440 "/etc/sudoers.d/90-${DEV_USER}"

log "Installing Docker Engine from the official Docker apt repository"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "${VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

log "Granting '${DEV_USER}' docker access"
usermod -aG docker "${DEV_USER}"

log "Enabling the docker service"
# systemd is only live after the distro restarts with the wsl.conf above, so
# tolerate failure on a first run and let the caller do `wsl --shutdown`.
systemctl enable docker >/dev/null 2>&1 || true
systemctl start docker  >/dev/null 2>&1 || true

log "Provisioning complete"
echo "Next, from Windows PowerShell:"
echo "  wsl --shutdown                 # apply systemd + default user"
echo "  wsl -d Ubuntu-24.04 -- docker version"
