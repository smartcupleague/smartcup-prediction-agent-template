# Release Checklist

Use this checklist before publishing or sharing the official SmartCup personal prediction agent template.

Goal: the repo should be safe to clone, configure, and run as a personal non-custodial agent without inheriting SmartPredictor-01 identity or paid-service workflows.

## 1. Scope Check

Confirm the template is personal-agent only:

- No paid-service menus, quote flows, customer fulfillment records, payment workflow docs, or monetization copy.
- Personal flows use the connected agent wallet by default.
- SmartPredictor-01 appears only as a reference implementation/model note.
- New users are directed to create their own wallet, Telegram bot, admin id, and agent identity.

## 2. Secret And Runtime File Check

The repo must not include:

- `.env`
- `.env.render.telegram`
- local SQLite files
- memory JSON files
- logs
- `dist`
- `node_modules`
- mnemonics, private keys, seed phrases, wallet JSON, browser sessions, or SubWallet exports
- real Telegram bot tokens
- private Render env values

Suggested checks:

```bash
git status --short
rg -n "mnemonic|private key|seed phrase|wallet json|TELEGRAM_BOT_TOKEN=|sb_secret|postgresql://|0x325188|kGgfy" . || true
```

Expected:

- No private secrets are found.
- The old SmartPredictor-01 public wallet/SS58 values are not present as defaults.
- Any SmartPredictor-01 text is reference-only.

## 3. Placeholder Identity Check

Confirm `.env.example` uses placeholders and guards:

```text
SMARTPREDICTOR_HANDLE=your_agent_handle
SMARTPREDICTOR_NAME=your_agent_name
SMARTPREDICTOR_PUBLIC_BOT_NAME=your_bot_display_name
SMARTPREDICTOR_WALLET_ACCOUNT=local_vara_wallet_name
SMARTPREDICTOR_WALLET_HEX=0xREPLACE_WITH_PUBLIC_WALLET
SMARTPREDICTOR_WALLET_SS58=ss58_replace_with_public_wallet
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
SMARTPREDICTOR_POLICY_MODE=read_only
```

Run:

```bash
zsh -n .env.example
npm run setup-check
```

Expected:

- Shell syntax is valid.
- Setup check warns if template/default identity is still in use.

## 4. Build And Smoke Checks

Run from the extracted template repo:

```bash
npm install
npm run check
npm run build
npm run telegram-bot -- --dry-run true
npm run telegram-nl-smoke -- --text "show me the menu" --format summary
npm run telegram-private-smoke -- --format summary
```

Expected:

- TypeScript passes.
- Build passes.
- Telegram dry-run validates config shape.
- NL smoke routes menu intent correctly.
- Private smoke passes without contacting Telegram.

## 5. Documentation Pack Check

Confirm these files exist and are linked from README:

- `QUICKSTART_PERSONAL_AGENT.md`
- `skills.md`
- `docs/first-run-checklist.md`
- `docs/reusable-user-agent-setup.md`
- `docs/telegram-bot-setup.md`
- `docs/telegram-bot-command-map.md`
- `docs/operator-cli.md`
- `docs/providers.md`
- `docs/manual-telegram-smoke-test.md`
- `docs/troubleshooting.md`
- `docs/release-checklist.md`

Confirm docs explain:

- Local setup is the default path.
- macOS `launchd` is optional local continuity.
- Render Background Worker polling is advanced hosted setup.
- Render webhook is the most advanced hosted path.
- One Telegram bot token should have only one active poller.
- Render needs a persistent disk for stable saved reports.

## 6. Telegram UX Check

Manual check before release:

```text
/start
/help
/menu
show my agent status
preview the next open match
show saved reports
show execution policy
```

Expected:

- `/menu` shows Predict, Strategy, Reports, Wallet & Safety, Settings.
- Personal flows do not ask for payment details or private wallet material.
- Saved-report detail shows guarded actions but does not submit by itself.
- Friendly outputs do not expose raw command logs, stack traces, raw indexer errors, or planck-only EV text.

Then run:

```text
docs/manual-telegram-smoke-test.md
```

## 7. Wallet Safety Check

Confirm policy and approval behavior:

- Default policy is `read_only`.
- Natural language cannot submit a transaction by itself.
- Live execution requires a saved report, explicit approval, and safety gates.
- Duplicate, cutoff, payload, balance, exposure, policy, and confirmation/readback guards remain enabled.
- Claim/refund/freebet flows never ask for private wallet material.

## 8. Provider Check

Confirm optional providers are framed as advisory:

- `football-data.org` is the implemented fixture/result adapter.
- Manual odds JSON and manual football-context JSON are documented.
- Live odds/news/injury/lineup providers are optional future adapters.
- Provider data never overrides SmartCup chain state or wallet safety guards.

## 9. Launchd And Render Check

macOS `launchd`:

```bash
bash -n scripts/install-macos-launchd.sh
bash -n scripts/uninstall-macos-launchd.sh
```

Expected:

- Default label is generic, not SmartPredictor-01-specific.
- `.env` is sourced at runtime.
- Telegram token is not copied into the plist.

Render polling docs:

- Background Worker settings are documented.
- Persistent disk mount `/var/data` is documented.
- `SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite` is documented.
- One-poller rule is explicit.

## 10. Final Git Check

Before first commit/push to the official repo:

```bash
git status --short
git diff --stat
```

Expected:

- Only intended template files are present.
- No runtime files or secrets are staged.
- The repo can be cloned and started from the documentation pack.

After push, clone it into a clean temporary folder and run the first-run checklist once.
