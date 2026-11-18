#!/usr/bin/env bash
# Installs scripts/casting-worker-relay.mjs as a macOS LaunchAgent: started at login and restarted if it exits, so the backend's casting
# worker socket survives a restart of the Mac (it is gone otherwise, and the backend reports the casting worker "unreachable").
#   bash scripts/install-casting-worker-relay.sh            install (or update) and start it
#   bash scripts/install-casting-worker-relay.sh --remove   stop and remove it
set -euo pipefail
LABEL=com.emithran.casting-worker-relay
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
unload() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  for _ in $(seq 1 50); do
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
  echo "$LABEL is still loaded after 10 s; try again" >&2
  return 1
}
if [[ "${1:-}" == "--remove" ]]; then
  unload
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi
NODE="$(command -v node)"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/casting-worker-relay.mjs"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.emithran"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.emithran/casting-bridge.log</string>
  <key>StandardErrorPath</key><string>$HOME/.emithran/casting-bridge.log</string>
</dict>
</plist>
PLIST
# Reinstalling: unload the running agent first. bootout returns before the job is gone, and a bootstrap while it is still there fails
# ("Bootstrap failed: 5: Input/output error"), leaving the agent unloaded: wait until launchd no longer has it (at most 10 s).
unload
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: $NODE $SCRIPT"
