# SmartCup Personal Agent Quickstart

Use this guide to create your own non-custodial SmartCup League prediction agent.

Reference note: SmartPredictor-01 is the first SmartCup League reference implementation/model for this personal-agent template. Use it as an example of what the agent can do, but configure your own wallet, Telegram bot, admin id, and agent identity before real use.

The agent can analyze matches, suggest predictions, show strategy, and prepare guarded plans. It does not need your mnemonic, private key, seed phrase, wallet JSON, browser session, or SubWallet export.

## Setup Path Hierarchy

Choose the simplest path that gives you what you need. Do not skip the local checks before hosting the bot.

### 1. Default: Local Personal Agent

Recommended first path for every user.

Flow:

1. Clone the repo.
2. Copy `.env.example` to `.env`.
3. Configure your wallet, tournament, Telegram admin id, and optional providers.
4. Run setup checks and CLI previews locally.
5. Start local Telegram polling only after the CLI works.

Why this is the default:

- Easiest to debug.
- Keeps runtime state on your computer.
- Keeps tokens and configuration close to you.
- Makes it obvious when Vara wallet, tournament profile, provider, or Telegram setup is wrong.

### 2. Optional Local Continuity: macOS launchd

Use after local polling works. It runs the same local agent and the same `.env`, but supervises the Telegram polling process.

Use it when you want polling to restart after crashes, terminal closes, or Mac login/reboot. This is optional and not required for the first setup.

### 3. Advanced Hosted: Render Background Worker Polling

Use when you want the Telegram bot online without keeping your laptop process running.

This path requires:

- Render environment variables.
- A persistent disk for SQLite memory if you want saved reports, preferences, alerts, and runtime policy to survive restarts.
- The one-poller rule: no local terminal polling, launchd polling, or other Render worker can use the same Telegram bot token at the same time.

Start hosted deployments in `read_only`. Move to `approval_required` only after smoke tests pass.

### 4. Most Advanced Hosted: Render Web Service Webhook

Use only after polling is stable and you understand public HTTPS webhook setup.

This path requires a public HTTPS route, webhook secret, Telegram webhook registration, routing, log hygiene, and operational monitoring. It is more complex than background-worker polling and should not be the default onboarding recommendation.

## What You Need

Required:

- Node.js `22.x`.
- A Vara wallet already created or imported.
- Your public wallet in both formats:
  - Hex: `0x...`
  - SS58: Vara address
- Your SmartCup profile/terms completed in the SmartCup app.
- The active SmartCup tournament program ids.

Optional:

- Telegram BotFather token.
- Numeric Telegram user id.
- Hosted indexer GraphQL URL.
- `football-data.org` token.
- Freebet Ledger id, once available.

For most users, start without any provider key. Add `football-data.org` later for fixture/result enrichment, then read `docs/providers.md` before adding odds, lineup, injury, suspension, or news sources.

Never put private wallet material in `.env`, Telegram, GitHub, Render, or chat.

## 1. Install

```bash
git clone https://github.com/smartcupleague/smartcup-prediction-agent-template.git
cd smartcup-prediction-agent-template
npm install
cp .env.example .env
```

## 2. Edit `.env`

The default `.env.example` values are placeholders. Replace them with your own personal agent identity before real use:

```text
SMARTPREDICTOR_HANDLE=<your_agent_handle>
SMARTPREDICTOR_NAME=<your_agent_name>
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_telegram_bot_name>

SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false

SMARTPREDICTOR_WALLET_ACCOUNT=<local_vara_wallet_name>
SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>

SMARTPREDICTOR_POLICY_MODE=read_only
SMARTPREDICTOR_MIN_STAKE_USD=3
SMARTPREDICTOR_MAX_STAKE_USD=5
SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_USD=100
```

Keep the current World Cup MVP IDL path unless the protocol team tells you the BolaoCore program was upgraded:

```text
SMARTCUP_BOLAO_IDL_PATH=artifacts/idl/bolao_program.idl
```

Do not use `artifacts/idl/bolao_program.freebet-v4.idl` with the current World Cup MVP BolaoCore program.

## 3. Verify Read-Only Agent

Run:

```bash
npm run setup-check
npm run sync
npm run onboarding -- --format summary
npm run plan-open-matches
```

You want to see:

- Your wallet address.
- Your SmartCup nickname/profile if available.
- Your balance.
- Your current predictions.
- Eligible matches.
- No secret-related warnings.

If this step fails, do not move to Telegram or execution yet.

## 4. Generate Your First Preview

Pick an eligible match id from `plan-open-matches`, then run:

```bash
npm run decide -- --match <match_id> --risk balanced --format summary --save true
```

Useful analysis commands:

```bash
npm run simulate -- --match <match_id> --objective balanced --format summary
npm run timing -- --match <match_id> --format summary
npm run crowd-map -- --match <match_id> --format summary
npm run position-strategy -- --match <match_id> --format summary
npm run alternatives -- --match <match_id> --format summary
```

## 5. Optional Telegram Setup

Create a bot with BotFather, then add:

```text
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<your_numeric_telegram_user_id>
TELEGRAM_MODE=polling
TELEGRAM_PREDICTION_ALERTS_ENABLED=true
TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30
```

Run smoke tests:

```bash
npm run telegram-bot -- --dry-run true
npm run telegram-private-smoke -- --format summary
```

Start local polling:

```bash
TELEGRAM_MODE=polling npm run telegram-bot
```

Only one polling process can run for the same bot token. Stop local polling before running a Render worker.

Prediction-window reminders are enabled by default. The bot scans eligible open matches and sends one reminder when about 30 minutes remain before SmartCup prediction close. Since SmartCup closes predictions 10 minutes before kickoff, the default reminder arrives about 40 minutes before kickoff. Reminders go to `TELEGRAM_PREDICTION_ALERT_CHAT_IDS` when set, otherwise to `TELEGRAM_ADMIN_IDS`.

## 6. Telegram Phrases To Test

Try these in a private DM with your bot:

```text
show my agent status
what games can I still predict?
preview the next open match
give me the next five open matches
analyze competitors and leaderboard for the next open match
show podium strategy
show tournament advisory
show alternative picks for the next open match
set risk to balanced
set policy read only
check my freebet balance
do I have anything to claim?
```

Expected behavior:

- The bot identifies the selected tournament.
- Personal prediction flows do not ask for third-party wallets or payment details.
- Operator-only actions work only for `TELEGRAM_ADMIN_IDS`.
- Live execution is blocked in `read_only`.

Expected friendly output:

- `Single Match` and `Next Open Match` show a prediction briefing, not terminal logs.
- A prediction briefing includes the recommended score, risk mode, confidence, home/draw/away probabilities, exact-score probability, expected tournament-points explanation, payout ROI as a percentage, capital at risk in VARA plus USD when available, data-quality warnings, and a next action.
- `5-Match Bundle` shows five personal recommendations, total expected points, total capital-at-risk context, timing/data-quality notes, and a per-match review priority.
- `Competitor Analysis` explains leaderboard posture, candidate scores, blockers, opponent coverage, and what to do next.
- `Agent Status` shows connected account, wallet, nickname, balance, selected tournament, prediction count, points/rank data when available, and execution policy.

Telegram personal outputs should not show raw `npm run` commands, `tsx`, `SQLite` warnings, stack traces, raw `prepared statement` errors, raw `vara-wallet --json call` logs, or planck-only EV text. The private smoke suite checks this:

```bash
npm run telegram-private-smoke -- --format summary
```

You want to see:

```text
Private Telegram smoke: PASS
Cases: 48/48 passed
PASS friendly output hygiene: personal flows hide raw logs and internal errors
PASS prediction closing alerts: due match sends once with friendly copy
```

## 7. Advanced Render Background Worker Setup

Use Render only after local CLI and local Telegram polling work. This path keeps the Telegram bot online without your laptop, but it requires hosted env vars, a persistent disk for SQLite memory, and no other poller using the same bot token.

Render service:

```text
Type: Background Worker
Build command: npm ci --include=dev && npm run build
Start command: TELEGRAM_MODE=polling npm run telegram-bot:prod
```

Add a persistent disk if you want saved reports, preferences, alert deduplication, and runtime policy changes to survive restarts:

```text
Disk mount path: /var/data
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
```

Minimum env vars:

```text
NODE_ENV=production
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_telegram_user_id>
TELEGRAM_MODE=polling
TELEGRAM_PREDICTION_ALERTS_ENABLED=true
TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_agent_name>
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
SMARTPREDICTOR_POLICY_MODE=read_only
SMARTPREDICTOR_WALLET_ACCOUNT=<wallet_account_name>
SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>
SMARTCUP_TOURNAMENT_PROFILE_PATH=tournaments/worldcup-2026.mvp.json
SMARTCUP_BOLAO_CORE_ID=<bolao_core_program_id>
SMARTCUP_ORACLE_ID=<oracle_program_id>
SMARTCUP_INDEXER_GRAPHQL_URL=<hosted_graphql_url>
SMARTCUP_API_URL=<smartcup_api_url>
SMARTPREDICTOR_MIN_STAKE_USD=3
SMARTPREDICTOR_MAX_STAKE_USD=5
SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_USD=100
```

Do not add mnemonics, private keys, wallet JSON, or browser sessions to Render.

## 8. Most Advanced Render Webhook Setup

Use webhook mode only after polling is stable. Webhook needs a public HTTPS web service, a Telegram webhook URL, webhook secret validation, routing, deploy logs, and operational monitoring. It is not the default onboarding path.

```text
Service type: Web Service
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://<render-service>.onrender.com/<telegram-path>
TELEGRAM_WEBHOOK_SECRET=<random_secret>
```

Stop all polling processes before enabling webhook for the same bot token.

## 9. Optional Approval-Required Mode

Stay in read-only until the bot works and previews are correct.

Then set:

```text
SMARTPREDICTOR_POLICY_MODE=approval_required
```

Rules:

- Natural language can create a saved decision preview.
- Natural language cannot submit a prediction.
- Execution requires an existing saved decision and an explicit approval button or `/operator_approve`.
- Duplicate, cutoff, balance, stake, exposure, and confirmation-readback guards must pass.

## Common Problems

`TELEGRAM_BOT_TOKEN is required`

- Add `TELEGRAM_BOT_TOKEN` to `.env` or Render env vars.
- Restart the bot process.

Bot does not reply

- Check that only one poller is running.
- Stop Render if local polling is active, or stop local polling if Render is active.
- Check `TELEGRAM_ADMIN_IDS` for operator commands.

Eligible matches cannot load

- Run `npm run setup-check`.
- Check `VARA_RPC_URL`.
- Check `SMARTCUP_BOLAO_CORE_ID`.
- Check `SMARTCUP_BOLAO_IDL_PATH=artifacts/idl/bolao_program.idl`.

Wrong or strange user bets

- Confirm you are not using `bolao_program.freebet-v4.idl` with the current MVP BolaoCore program.

Indexer warnings

- The agent can still use direct chain reads for canonical state.
- Hosted indexer improves history, opponent, and leaderboard context.

## Next Docs

- Full reusable setup: `docs/reusable-user-agent-setup.md`
- Telegram setup: `docs/telegram-bot-setup.md`
- Telegram commands: `docs/telegram-bot-command-map.md`
- Operator CLI: `docs/operator-cli.md`
- Provider setup: `docs/providers.md`
- First-run checklist: `docs/first-run-checklist.md`
- Troubleshooting: `docs/troubleshooting.md`
- Release checklist: `docs/release-checklist.md`
