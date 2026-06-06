#!/usr/bin/env bash
set -euo pipefail

LABEL="${SMARTPREDICTOR_LAUNCHD_LABEL:-com.smartcup.prediction-agent.telegram}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
USER_DOMAIN="gui/$(id -u)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller is for macOS launchd only." >&2
  exit 1
fi

launchctl bootout "$USER_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Uninstalled launchd service: $LABEL"
echo "Removed plist: $PLIST_PATH"
echo "Logs are not removed automatically. Check logs/launchd inside the project if cleanup is needed."
