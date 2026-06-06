# First-Run Checklist

Use this checklist the first time you clone and configure the SmartCup personal prediction agent template.

Goal: reach a working read-only personal agent before enabling Telegram hosting or guarded wallet execution.

## 1. Clone And Install

```bash
git clone https://github.com/smartcupleague/smartcup-prediction-agent-template.git
cd smartcup-prediction-agent-template
npm install
cp .env.example .env
```

Do not commit `.env`.

## 2. Configure Identity And Wallet

Edit `.env` and replace template placeholders:

```text
SMARTPREDICTOR_HANDLE=<your_agent_handle>
SMARTPREDICTOR_NAME=<your_agent_name>
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_bot_display_name>
SMARTPREDICTOR_WALLET_ACCOUNT=<local_vara_wallet_name>
SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>
SMARTPREDICTOR_POLICY_MODE=read_only
```

Keep setup guard enabled:

```text
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
```

Safety check:

- Do not add mnemonic, private key, seed phrase, wallet JSON, browser session, or SubWallet export.
- The agent only needs public wallet identity and local wallet command access.

## 3. Configure Tournament Programs

Confirm `.env` and tournament profile point to the active SmartCup tournament:

```text
SMARTCUP_TOURNAMENT_PROFILE_PATH=tournaments/worldcup-2026.mvp.json
SMARTCUP_BOLAO_CORE_ID=<bolao_core_program_id>
SMARTCUP_ORACLE_ID=<oracle_program_id>
SMARTCUP_BOLAO_IDL_PATH=artifacts/idl/bolao_program.idl
```

Do not use `artifacts/idl/bolao_program.freebet-v4.idl` with an older/current MVP BolaoCore program unless the protocol team confirms the program was upgraded.

## 4. Run Local Readiness Checks

```bash
npm run check
npm run build
npm run setup-check
npm run sync
npm run onboarding -- --format summary
npm run plan-open-matches
```

Expected:

- Setup guard does not report template/default identity still in use.
- Wallet and selected tournament are visible.
- SmartCup profile/readiness is visible when available.
- Eligible open matches are listed, or the bot explains why none are eligible.

If this step fails, stay in `read_only` and use `docs/troubleshooting.md`.

## 5. Generate First Read-Only Preview

Choose an eligible match id from `plan-open-matches`:

```bash
npm run decide -- --match <match_id> --risk balanced --stake-usd 3 --format summary --save true
npm run list-reports -- --limit 5
```

Expected:

- A friendly prediction summary is generated.
- A saved `DecisionReport` appears in `list-reports`.
- No transaction is submitted.

## 6. Optional Telegram Local Polling

Create a bot with BotFather, then configure:

```text
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_telegram_user_id>
TELEGRAM_MODE=polling
```

Run local checks:

```bash
npm run telegram-bot -- --dry-run true
npm run telegram-private-smoke -- --format summary
```

Start local polling only after the smoke test passes:

```bash
TELEGRAM_MODE=polling npm run telegram-bot
```

Telegram checks:

```text
/start
/help
/menu
show my agent status
preview the next open match
show saved reports
```

Expected:

- The bot replies in private DM.
- Menu sections are visible: Predict, Strategy, Reports, Wallet & Safety, Settings.
- Personal prediction flows do not ask for private wallet material or payment details.
- Live execution remains blocked in `read_only`.

## 7. Optional Local Continuity

After local polling works, optionally install macOS `launchd` supervision:

```bash
npm run build
npm run telegram-bot:launchd:install
```

Only use one poller for the same bot token. Stop terminal polling before relying on `launchd`.

## 8. Optional Hosted Polling

Use Render Background Worker polling only after local CLI and local Telegram polling are stable.

Required hosted memory:

```text
Disk mount path: /var/data
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
```

One-poller rule:

- Stop local terminal polling and unload/pause `launchd` before starting Render polling for the same bot token.

## 9. Before Guarded Execution

Do not switch from `read_only` to `approval_required` until all are true:

- `npm run setup-check` passes.
- `npm run telegram-private-smoke -- --format summary` passes.
- A saved report can be listed/exported.
- Duplicate/cutoff/balance/exposure/payload guards are understood.
- You know how to return to `read_only`.

Guarded execution still requires explicit approval and safety gates. Natural language alone must never submit a transaction.

## First-Run Pass Criteria

You are ready to continue when:

- Local setup checks pass.
- At least one read-only preview is saved.
- Telegram local smoke passes if using Telegram.
- The selected tournament is clear in replies.
- Saved reports persist in the configured SQLite path.
- No private wallet material is present in project files, Render env vars, Telegram, or Git.
