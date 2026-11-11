#!/usr/bin/env bash
# One-time setup so the VM retry never depends on a browser login that expires.
#
#   OCI_CLI_PROFILE=<admin session profile, after `oci session authenticate`> IMAGE_ID=<ocid> infra/oracle/launcher-setup.sh
#
# What it does, and why:
#  1. A dedicated IAM user + group "emithran-vm-launcher" whose ONLY rights are launching/inspecting compute and using the network. Its API key
#     lives on this Mac. If the key leaked, it could not touch billing, users, databases or storage; your admin login is not on disk for the retry.
#  2. An API key (RSA 2048, mode 600, under ~/.oci) for that user: it does not expire like a browser session (revoke it any time in the console).
#  3. ~/.emithran/oracle.env with the settings vm-retry.sh needs, and a launchd agent that runs vm-retry.sh every 10 minutes (survives reboots).
# Safe to re-run: existing users, groups, policies, keys and the agent are reused or replaced, never duplicated.
set -Eeuo pipefail
trap 'echo "launcher-setup.sh failed at line $LINENO" >&2' ERR
: "${IMAGE_ID:?IMAGE_ID (the Ubuntu aarch64 image ocid)}"
export OCI_CLI_AUTH=security_token PYTHONWARNINGS=ignore
q() { oci "$@" 2> >(grep -v -E 'SyntaxWarning|INSTANCE_CONSOLE|Interactive mode' >&2); }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name=emithran-vm-launcher
tenancy="$(q iam availability-domain list --query 'data[0]."compartment-id"' --raw-output)"
region="$(q iam region-subscription list --query 'data[?"is-home-region"]|[0]."region-name"' --raw-output)"

group="$(q iam group list --name "$name" --query 'data[0].id' --raw-output 2>/dev/null || true)"
case "$group" in ocid1.*) ;; *) group="$(q iam group create --name "$name" --description "Launches the free VM only" --query 'data.id' --raw-output)" ;; esac
user="$(q iam user list --name "$name" --query 'data[0].id' --raw-output 2>/dev/null || true)"
case "$user" in ocid1.*) ;; *) user="$(q iam user create --name "$name" --description "API-key user for the VM retry (no console login)" --query 'data.id' --raw-output)" ;; esac
q iam group add-user --user-id "$user" --group-id "$group" >/dev/null 2>&1 || true   # already a member is fine

stmts='["Allow group '$name' to manage instance-family in tenancy","Allow group '$name' to use virtual-network-family in tenancy","Allow group '$name' to use volume-family in tenancy","Allow group '$name' to inspect compartments in tenancy"]'
pol="$(q iam policy list -c "$tenancy" --name "$name" --query 'data[0].id' --raw-output 2>/dev/null || true)"
case "$pol" in ocid1.*) q iam policy update --policy-id "$pol" --statements "$stmts" --force >/dev/null ;;
  *) q iam policy create -c "$tenancy" --name "$name" --description "Least privilege for the VM retry" --statements "$stmts" >/dev/null ;; esac

key="$HOME/.oci/${name}.pem"; pub="$HOME/.oci/${name}_public.pem"; mkdir -p "$HOME/.oci"
if [ ! -f "$key" ]; then
  (umask 077; openssl genrsa -out "$key" 2048 >/dev/null 2>&1); chmod 600 "$key"; openssl rsa -pubout -in "$key" -out "$pub" >/dev/null 2>&1
  fp="$(q iam user api-key upload --user-id "$user" --key-file "$pub" --query 'data.fingerprint' --raw-output)"
  { printf '\n[%s]\nuser=%s\nfingerprint=%s\ntenancy=%s\nregion=%s\nkey_file=%s\n' "$name" "$user" "$fp" "$tenancy" "$region" "$key"; } >> "$HOME/.oci/config"
fi

subnet="$(q network subnet list -c "$tenancy" --display-name emithran-public-subnet --query 'data[0].id' --raw-output)"
mkdir -p "$HOME/.emithran/oracle-retry"
cat > "$HOME/.emithran/oracle.env" <<ENV
OCI_CLI_PROFILE=$name
OCI_CLI_AUTH=api_key
COMPARTMENT_ID=$tenancy
SUBNET_ID=$subnet
IMAGE_ID=$IMAGE_ID
SSH_PUBLIC_KEY_FILE=$HOME/.ssh/emithran_prod_ed25519.pub
ENV
chmod 600 "$HOME/.emithran/oracle.env"

# prove the new key works before trusting it with an unattended job (policy changes can take a few seconds to apply)
for i in 1 2 3 4 5 6; do
  OCI_CLI_PROFILE=$name OCI_CLI_AUTH=api_key oci iam availability-domain list -c "$tenancy" >/dev/null 2>&1 && ok=1 && break; sleep 10
done
[ "${ok:-}" = 1 ] || { echo "the new key was not accepted after 60 s: re-run this script" >&2; exit 1; }

plist="$HOME/Library/LaunchAgents/com.emithran.oracle-retry.plist"
cat > "$plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.emithran.oracle-retry</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$here/vm-retry.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.emithran/oracle-retry/launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.emithran/oracle-retry/launchd.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.emithran.oracle-retry" >/dev/null 2>&1 || true
rm -f "$HOME/.emithran/oracle-retry/RESULT"
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "done: user $name, API key $key, retry scheduled every 10 minutes. Log: ~/.emithran/oracle-retry/retry.log"
