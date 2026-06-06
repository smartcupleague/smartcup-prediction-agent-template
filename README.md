# SmartCup Prediction Agent Template

Build your own personal, non-custodial SmartCup League prediction agent for Vara.

This repository is a reusable template. It helps a SmartCup League user run a private agent that can read tournament state, model football outcomes, compare strategy options, save reports, and prepare guarded wallet actions. The agent never needs your mnemonic, private key, wallet JSON, browser session, or SubWallet export.

SmartPredictor-01 is the first reference implementation/model created by the SmartCup League team for a non-custodial personal prediction agent. This template keeps the working personal-agent functionality from that reference build, but new users must configure their own wallet, Telegram bot, admin id, and agent identity.

## What The Agent Does

- Reads SmartCup League on-chain state through Vara/BolaoCore queries.
- Finds eligible open matches for the connected wallet.
- Produces scoreline probabilities with a deterministic rating and Poisson model.
- Adds timing, crowd, leaderboard, position, alternative-pick, and data-quality analysis.
- Saves personal `DecisionReport` records in local SQLite memory.
- Exports personal reports as Markdown or JSON.
- Supports Telegram menus, buttons, and natural-language commands.
- Builds guarded transaction plans for personal wallet actions such as `PlaceBet`, `SubmitPodiumPick`, claims, refund recovery, and optional freebet usage.

The default posture is read-only. Live wallet execution requires explicit setup, an operator Telegram id, a saved report, approval mode, and safety checks.

## Start Here

Default recommended path:

```text
Local personal agent -> Local Telegram polling -> Optional launchd -> Optional Render polling -> Optional webhook
```

Start locally first. The local path is easiest to debug and keeps runtime state on your computer while you confirm wallet, tournament, provider, and Telegram setup.

First setup flow:

1. Clone the repo.
2. Copy `.env.example` to `.env`.
3. Replace the template wallet, Telegram, tournament, and provider values.
4. Run setup checks locally.
5. Generate a read-only prediction preview.
6. Start local Telegram polling only after the CLI works.
7. Optionally add macOS `launchd` if you want the local bot to restart after crashes or reboot.
8. Optionally move to Render Background Worker polling if you want the bot hosted online.
9. Use Render Web Service webhook only as the most advanced hosted path after polling is stable.
10. Move to guarded `approval_required` mode only after smoke tests pass.

```bash
git clone https://github.com/smartcupleague/smartcup-prediction-agent-template.git
cd smartcup-prediction-agent-template
npm install
cp .env.example .env
# Edit .env now: wallet, tournament, Telegram admin id, and optional providers.
npm run setup-check
npm run telegram-private-smoke -- --format summary
```

Then follow the quickstart:

```text
QUICKSTART_PERSONAL_AGENT.md
```

## Documentation Pack

Read these in order:

1. `QUICKSTART_PERSONAL_AGENT.md` - shortest setup path for a personal agent.
2. `.env.example` - copy to `.env` and replace placeholders.
3. `skills.md` - capability and safety profile for the personal agent.
4. `docs/reusable-user-agent-setup.md` - full setup path for another user.
5. `docs/telegram-bot-setup.md` - BotFather, local polling, launchd, Render polling, webhook notes.
6. `docs/telegram-bot-command-map.md` - Telegram menus, buttons, commands, and natural-language phrases.
7. `docs/operator-cli.md` - terminal command reference.
8. `docs/providers.md` - optional sports-data, odds, lineup, injury, suspension, and news providers.
9. `docs/local-storage.md` - SQLite memory, saved reports, preferences, plans, and inspection.
10. `docs/manual-telegram-smoke-test.md` - release checklist for Telegram behavior.
11. `docs/first-run-checklist.md` - step-by-step first local setup checklist.
12. `docs/troubleshooting.md` - common setup, provider, memory, Telegram, and wallet-read issues.
13. `docs/release-checklist.md` - pre-publication checklist for the official template repo.

## Required Setup

Prerequisites:

- Node.js 22.x
- npm
- Vara wallet CLI support through `npm exec --package=vara-wallet` or `VARA_WALLET_BIN`
- A local Vara wallet account for your agent
- A Telegram bot token if using Telegram
- Your numeric Telegram user id in `TELEGRAM_ADMIN_IDS`

Minimum local configuration:

```text
SMARTPREDICTOR_HANDLE=<your_agent_handle>
SMARTPREDICTOR_NAME=<your_agent_name>
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_bot_display_name>
SMARTPREDICTOR_WALLET_ACCOUNT=<local_vara_wallet_name>
SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>
SMARTPREDICTOR_POLICY_MODE=read_only
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_telegram_user_id>
```

Never put private wallet material in `.env`, Telegram, GitHub, Render, or chat.

## SmartCup Programs And IDLs

The template includes IDL snapshots under:

```text
artifacts/idl/
```

Current default BolaoCore IDL:

```text
SMARTCUP_BOLAO_IDL_PATH=artifacts/idl/bolao_program.idl
```

The freebet-v4 BolaoCore IDL is preserved for future protocol migration tests, but do not use it with the current MVP BolaoCore program unless the SmartCup protocol team confirms the program was upgraded.

Program IDs are configured through `.env` and tournament profiles:

```text
SMARTCUP_BOLAO_CORE_ID=<bolao_core_program_id>
SMARTCUP_ORACLE_ID=<oracle_program_id>
SMARTCUP_FREEBET_LEDGER_ID=<optional_freebet_ledger_program_id>
SMARTCUP_TOURNAMENT_PROFILE_PATH=tournaments/worldcup-2026.mvp.json
```

## Safety Model

The agent is non-custodial.

It can:

- Read public chain and tournament state.
- Generate recommendations and reports.
- Save local memory.
- Prepare transaction plans.
- Ask for explicit approval before guarded wallet actions.

It must not:

- Ask for seed phrases, private keys, wallet JSON, browser sessions, or SubWallet exports.
- Submit a transaction from natural language alone.
- Submit when duplicate prediction, cutoff, payload, balance, exposure, policy, or readback safety cannot be proven.
- Promise profit, rank, payout, or match result accuracy.

## Run Modes

`read_only`

The agent may read state, generate reports, and save local memory. It cannot submit wallet actions.

`approval_required`

The agent may prepare transaction plans. A human operator must approve each live action after all guards pass.

`claim_only`

The agent may claim eligible wallet-owned rewards, final prizes, or refund recovery. It cannot place new predictions.

`tournament_autopilot`

Reserved for future production use after separate live-smoke and safety verification. New agents should not start here.

## Common Commands

First-run setup and status:

```bash
npm run setup-check
npm run sync
npm run onboarding -- --format summary
npm run profile
npm run plan-open-matches
npm run report
```

Prediction and strategy:

```bash
npm run decide -- --match <match_id> --risk balanced --format summary
npm run simulate -- --match <match_id> --iterations 2000 --objective balanced
npm run timing -- --match <match_id>
npm run alternatives -- --match <match_id>
npm run position-strategy -- --match <match_id>
```

Reports:

```bash
npm run list-reports
npm run export-report -- --format markdown
npm run export-report -- --format json
npm run calibration -- --format summary
```

Wallet-safety checks:

```bash
npm run claim -- pending --format summary
npm run freebet -- status --format summary
npm run refund -- status --format summary
```

Guarded execution:

```bash
npm run submit -- --decision <decision_id> --format summary
```

Start in `read_only`. Switch to `approval_required` only after setup and smoke tests pass.

## Telegram

Run a dry-run first:

```bash
npm run telegram-bot -- --dry-run true
```

Start local polling:

```bash
TELEGRAM_MODE=polling npm run telegram-bot
```

Useful Telegram phrases:

```text
show my agent status
what games can I still predict?
preview the next open match
give me the next five open matches
analyze competitors and leaderboard for the next open match
show podium strategy
show tournament advisory
show alternative picks for the next open match
check my freebet balance
do I have anything to claim?
```

Only one process may use a Telegram bot token at a time. Do not run local polling, macOS `launchd`, and Render polling simultaneously for the same bot token.

## Deployment Options

Default path: local CLI and local Telegram polling.

Optional local continuity: macOS `launchd` so the bot restarts after terminal close, crash, or reboot.

Advanced hosted path: Render Background Worker with Telegram polling and a persistent disk for SQLite memory.

Most advanced hosted path: Render Web Service with Telegram webhook. Use this only after polling is stable and you understand public HTTPS webhook setup.

See:

```text
docs/telegram-bot-setup.md
docs/reusable-user-agent-setup.md
```

## Local Memory

The agent stores durable local memory in SQLite and keeps a JSON compatibility mirror.

Default template path:

```text
SMARTPREDICTOR_SQLITE_PATH=data/smartcup-agent.memory.sqlite
```

Memory includes saved decisions, prediction records, transaction plans, transaction results, evaluation/calibration records, Telegram preferences, runtime policy, parser telemetry, and prediction-window alert deduplication.

## Optional Providers

The agent can run with chain and SmartCup data only, but analysis improves when optional providers are configured.

Supported provider surfaces:

- football-data.org fixtures/results
- manual odds JSON
- manual lineup/injury/suspension/news context JSON
- future odds/news providers through the provider interfaces

See:

```text
docs/providers.md
```

## SmartPredictor-01 Reference Note

SmartPredictor-01 is the first reference implementation/model used by SmartCup League to prove the personal-agent flow. Treat it as the example build, not the identity for a cloned user agent. New agents should replace wallet, Telegram bot, admin id, public profile, and naming values before production use.

The setup guard is designed to catch accidental production runs that still use reference identity values.

## Release Checklist

Before sharing a configured personal agent broadly:

```bash
npm run setup-check
npm run telegram-private-smoke -- --format summary
npm run build
```

Then run the manual Telegram checklist and release checklist:

```text
docs/manual-telegram-smoke-test.md
docs/release-checklist.md
```

A ready personal agent should:

- Keep personal flows separate from any paid-service concepts.
- Show friendly Telegram output with no raw command logs or stack traces.
- Keep wallet execution blocked unless explicit approval and safety checks pass.
- Persist saved reports and preferences through local SQLite or hosted persistent disk.
- Clearly show the selected tournament for match and report actions.
