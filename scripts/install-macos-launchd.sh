#!/usr/bin/env bash
set -euo pipefail

LABEL="${SMARTPREDICTOR_LAUNCHD_LABEL:-com.smartcup.prediction-agent.telegram}"
PROJECT_DIR="${SMARTPREDICTOR_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${SMARTPREDICTOR_ENV_FILE:-$PROJECT_DIR/.env}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
LOG_DIR="${SMARTPREDICTOR_LAUNCHD_LOG_DIR:-$PROJECT_DIR/logs/launchd}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS launchd only." >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory not found: $PROJECT_DIR" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "Create .env first and include TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS, and agent config." >&2
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/dist/cli.js" ]]; then
  echo "Built CLI not found: $PROJECT_DIR/dist/cli.js" >&2
  echo "Run npm run build before installing the LaunchAgent." >&2
  exit 1
fi

if ! grep -q '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE"; then
  echo "Warning: TELEGRAM_BOT_TOKEN was not found in $ENV_FILE." >&2
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

COMMAND="cd \"$PROJECT_DIR\" && export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$PATH\" && if [ -f \"$ENV_FILE\" ]; then set -a; source \"$ENV_FILE\"; set +a; fi; export TELEGRAM_MODE=\"\${TELEGRAM_MODE:-polling}\"; exec npm run telegram-bot:prod"
ESCAPED_COMMAND="$(printf '%s' "$COMMAND" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
ESCAPED_PROJECT_DIR="$(printf '%s' "$PROJECT_DIR" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
ESCAPED_STDOUT="$(printf '%s' "$LOG_DIR/telegram-bot.out.log" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
ESCAPED_STDERR="$(printf '%s' "$LOG_DIR/telegram-bot.err.log" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$ESCAPED_PROJECT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>$ESCAPED_COMMAND</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$ESCAPED_STDOUT</string>
  <key>StandardErrorPath</key>
  <string>$ESCAPED_STDERR</string>
</dict>
</plist>
PLIST

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$PLIST_PATH"
fi

USER_DOMAIN="gui/$(id -u)"
launchctl bootout "$USER_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "$USER_DOMAIN" "$PLIST_PATH"
launchctl kickstart -k "$USER_DOMAIN/$LABEL" >/dev/null 2>&1 || true

echo "Installed launchd service: $LABEL"
echo "Plist: $PLIST_PATH"
echo "Logs:"
echo "  $LOG_DIR/telegram-bot.out.log"
echo "  $LOG_DIR/telegram-bot.err.log"
echo ""
echo "Check status:"
echo "  launchctl print $USER_DOMAIN/$LABEL"
echo ""
echo "Stop local terminal polling and Render polling when this LaunchAgent is active for the same bot token."
