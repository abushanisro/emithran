#!/usr/bin/env bash
# ONE attempt to get the free Oracle VM, meant to run on a schedule (the launchd agent installed by launcher-setup.sh runs it every 10 minutes).
# Stateless on purpose: nothing lives in a long-running shell, so a reboot, a sleep or a closed terminal cannot kill it.
#
#   success   -> writes ~/.emithran/oracle-retry/RESULT, shows a notification, and removes the schedule (nothing keeps trying once a VM exists)
#   capacity  -> logs one line and exits 0 (the normal case: Oracle's free ARM capacity is often exhausted; the next run tries again)
#   login     -> the API key was rejected or revoked: a notification, at most one per 6 hours, then exits 0 (the schedule keeps running)
#   other     -> the first lines of Oracle's answer are logged and notified, at most one per 6 hours
# Overlapping runs are refused with a lock directory. The settings come from ~/.emithran/oracle.env (written by launcher-setup.sh).
set -u
STATE="${ORACLE_RETRY_STATE:-$HOME/.emithran/oracle-retry}"
CONF="${ORACLE_ENV:-$HOME/.emithran/oracle.env}"
mkdir -p "$STATE"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$STATE/retry.log"; }
notify() { # $1 kind (rate-limited per kind), $2 message
  local f="$STATE/notified-$1"
  if [ ! -f "$f" ] || [ -n "$(find "$f" -mmin +360 2>/dev/null)" ]; then
    : > "$f"; osascript -e "display notification \"$2\" with title \"eMithran: Oracle VM\"" >/dev/null 2>&1 || true
  fi
}
[ -f "$STATE/RESULT" ] && exit 0
[ -f "$CONF" ] || { log "missing $CONF (run infra/oracle/launcher-setup.sh)"; exit 2; }
# shellcheck source=/dev/null
set -a; . "$CONF"; set +a
mkdir "$STATE/lock" 2>/dev/null || { log "previous run still going, skipped"; exit 0; }
trap 'rmdir "$STATE/lock" 2>/dev/null' EXIT

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$(TRIES=1 SIZES="${SIZES:-4:24 2:12 1:6}" bash "$here/vm.sh" 2>&1)"; rc=$?
last="$(printf '%s\n' "$out" | tail -1)"

if [ "$rc" -eq 0 ] && printf '%s' "$last" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  size="$(printf '%s\n' "$out" | grep 'launched with' | tail -1)"
  printf 'SUCCESS ip=%s %s at %s\n' "$last" "$size" "$(date '+%F %T')" > "$STATE/RESULT"
  log "VM created: $last $size"
  osascript -e "display notification \"VM created at $last\" with title \"eMithran: Oracle VM\"" >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)/com.emithran.oracle-retry" >/dev/null 2>&1 || true
  exit 0
fi
if printf '%s' "$out" | grep -qi 'no capacity after\|out of host capacity\|out of capacity'; then
  log "no capacity (4:24, 2:12, 1:6 all refused)"; exit 0
fi
if printf '%s' "$out" | grep -qiE 'NotAuthenticated|NotAuthorized|session has expired|re-authenticate|InvalidKey|invalid.*signature|"status": ?40[13]'; then
  log "login problem: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
  notify login "Oracle login was rejected: run infra/oracle/launcher-setup.sh again"; exit 0
fi
log "unexpected: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
notify other "Oracle retry hit an unexpected error: see ~/.emithran/oracle-retry/retry.log"
exit 0
