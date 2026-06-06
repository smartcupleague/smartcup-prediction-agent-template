# Scripts

Utility scripts for the SmartCup personal prediction agent template live here. Keep wallet-sensitive scripts explicit and documented.

## macOS launchd Telegram Bot

- `install-macos-launchd.sh` installs a user LaunchAgent for private Telegram polling.
- `uninstall-macos-launchd.sh` stops and removes that LaunchAgent.

The LaunchAgent runs `npm run telegram-bot:prod`, sources the project `.env` at runtime, and logs to `logs/launchd/`.

Safety notes:

- Run `npm run build` before installing.
- Stop terminal polling and Render polling for the same bot token before enabling launchd.
- Do not put mnemonics, private keys, wallet JSON, or browser sessions in `.env` or the plist.
