# Reusable SmartCup Personal Agent Setup

Purpose: help a SmartCup participant set up their own non-custodial personal prediction agent with wallet safety, tournament context, Telegram access, natural-language use, and first-prediction readiness.

SmartPredictor-01 is the first SmartCup League reference implementation/model for this personal-agent pattern. Treat it as the example build, not as the identity for a cloned user agent.

## Safety Rules

- Never paste a mnemonic, private key, seed phrase, browser session, or wallet JSON into Telegram.
- The agent gives recommendations and can prepare guarded transaction plans.
- The user keeps custody and signs with their own wallet.
- Natural language cannot submit a transaction by itself.
- Live execution requires personal admin permission, policy gates, safety checks, an existing saved `DecisionReport`, and explicit approval.
- No result, payout, rank, or profit is guaranteed.

## Setup Checklist

1. Create or import a Vara wallet for the participant.
2. Configure the agent wallet values in `.env`:

   The checked-in wallet and bot values are template placeholders. A reusable personal deployment should replace them with the agent owner's own public wallet, bot name, and Telegram admin id.

   ```text
   SMARTPREDICTOR_WALLET_ACCOUNT=<local_wallet_name>
   SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
   SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>
   VARA_WALLET_BIN=/usr/local/bin/vara-wallet
   ```

3. Configure the active SmartCup tournament profile:

   ```text
   SMARTCUP_TOURNAMENT_PROFILE_PATH=tournaments/worldcup-2026.mvp.json
   SMARTCUP_BOLAO_CORE_ID=<bolao_core_program_id>
   SMARTCUP_ORACLE_ID=<oracle_program_id>
   SMARTCUP_INDEXER_GRAPHQL_URL=<hosted_graphql_url>
   ```

4. Configure execution policy. New user agents should start in read-only mode:

   ```text
   SMARTPREDICTOR_POLICY_MODE=read_only
   SMARTPREDICTOR_MIN_STAKE_USD=3
   SMARTPREDICTOR_MAX_STAKE_USD=5
   SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_USD=100
   ```

5. Configure Telegram if the user wants a chat interface:

   ```text
   TELEGRAM_BOT_TOKEN=<botfather_token>
   TELEGRAM_ADMIN_IDS=<numeric_user_id>
   TELEGRAM_MODE=polling
   SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_agent_bot_display_name>
   ```

6. Open SmartCup League in the browser with the wallet connected.
7. Read and accept the Terms of Use and rules.
8. Confirm age eligibility if prompted.
9. Set or confirm SmartCup nickname/profile.
10. Run readiness checks:

    ```bash
    npm run setup-check
    npm run sync
    npm run profile
    npm run onboarding -- --format summary
    npm run plan-open-matches
    ```

11. Run Telegram local safety checks:

    ```bash
    npm run telegram-bot -- --dry-run true
    npm run telegram-private-smoke -- --format summary
    ```

## Deployment Options

Choose one setup path at a time. The default onboarding path is local, not hosted.

### Default Path: Local Personal Agent

Use this first. The user clones the repo, configures `.env`, runs setup checks, uses CLI locally, then starts local Telegram polling.

This is the recommended first path because it is easiest to debug and keeps all secrets, tokens, and runtime state on the user's computer.

```text
Local CLI checks -> Local Telegram polling -> Read-only previews -> Manual smoke test
```

### Optional Local Continuity: macOS launchd

Use after local Telegram polling works. It uses the same local project and the same `.env`, but supervises the polling process so it restarts after crashes, terminal closes, or Mac login/reboot.

This is optional. It is not required for first setup.

### Advanced Hosted Path: Render Background Worker Polling

Use when the user wants the bot online without keeping their laptop process running.

This requires Render env vars, a persistent disk for SQLite memory, and the one-poller rule: no other local terminal, launchd service, or hosted worker may use the same Telegram bot token at the same time.

### Most Advanced Hosted Path: Render Web Service Webhook

Use only after polling is stable. This requires public HTTPS webhook setup, webhook secret handling, routing, and operational monitoring.

Webhook is more complex than background-worker polling and should not be the default onboarding recommendation.

### macOS LaunchAgent Local Option

Use `launchd` when the user wants a private local bot that keeps running without an open terminal.

```bash
npm install
npm run build
npm run telegram-bot -- --dry-run true
npm run telegram-bot:launchd:install
```

The installer writes a user LaunchAgent under `~/Library/LaunchAgents`, sources the project `.env` at runtime, and logs to `logs/launchd/`. It does not copy the Telegram token, mnemonic, private key, wallet JSON, or browser session into the plist.

Default launchd label:

```text
com.smartcup.prediction-agent.telegram
```

Useful commands:

```bash
launchctl print gui/$(id -u)/com.smartcup.prediction-agent.telegram
launchctl kickstart -k gui/$(id -u)/com.smartcup.prediction-agent.telegram
npm run telegram-bot:launchd:uninstall
```

## Advanced Render Background Worker Polling

Use this path only after local CLI and local Telegram polling are stable, when the user wants the bot online without keeping a terminal open.

Render settings:

```text
Service type: Background Worker
Root directory: leave blank for a standalone repo; use the project subfolder only in a monorepo
Build command: npm ci --include=dev && npm run build
Start command: TELEGRAM_MODE=polling npm run telegram-bot:prod
```

Add a persistent disk if the user wants saved reports and preferences to survive restarts:

```text
Disk name: smartcup-agent-memory
Mount path: /var/data
Minimum size: 1 GB
```

Then set:

```text
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
```

Without this disk, Render may lose local SQLite memory after a restart or redeploy. The bot will still run, but `Saved Decisions`, `Export Report`, runtime policy persistence, Telegram preferences, and alert deduplication can reset.

Minimum Render environment:

```text
NODE_ENV=production
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_admin_ids>
TELEGRAM_MODE=polling
SMARTPREDICTOR_PUBLIC_BOT_NAME=<bot_display_name>
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
SMARTPREDICTOR_POLICY_MODE=read_only
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
SMARTPREDICTOR_WALLET_ACCOUNT=<local_or_runtime_wallet_name>
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

Start in `read_only`. Move to `approval_required` only after private smokes pass and the agent owner has reviewed how wallet execution is handled in that runtime.

Signing note:

- Hosted analysis, status checks, saved reports, and decision previews do not need a mnemonic.
- Hosted live signing requires careful wallet/runtime design and should not be enabled by default for reusable users.
- The reusable default is non-custodial: generate recommendations and let the user sign in their own wallet unless they explicitly configure guarded personal admin execution.

## Most Advanced Render Webhook Path

Use webhook only after the polling bot is stable and the user understands public HTTPS webhook setup, webhook secrets, routing, deploy logs, and operational monitoring.

Webhook shape:

```text
Service type: Web Service
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://<render-service>.onrender.com/<telegram-path>
TELEGRAM_WEBHOOK_SECRET=<random_secret>
```

Webhook advantages:

- Telegram pushes updates directly to the HTTPS service.
- Better long-term shape for production integrations.

Webhook tradeoffs:

- Requires a public HTTPS URL and secret validation.
- More moving pieces to debug.
- Needs stricter route exposure and log hygiene.

## Natural-Language Telegram Examples

Personal user-facing phrases:

```text
How am I doing?
Show my stats for the World Cup.
What games can I still predict?
Preview the next open match.
Show me the next five open matches.
Check my freebet balance.
Do I have anything to claim?
```

Personal admin phrases:

```text
Analyze match 4 with balanced risk and 3 dollars cash.
Prepare a prediction for the next open match using contrarian mode.
Show execution policy.
Set policy read only.
Set policy approval required.
Approve decision <saved_decision_id>.
```

Clarification examples:

```text
Analyze with balanced risk.
Approve the prediction.
Change tournament.
```

The bot should ask a clarifying question or block safely. It should not guess the match, tournament, saved decision, or execution intent.

## First Prediction Flow

Start with read-only analysis:

```bash
npm run onboarding -- --format summary
npm run plan-open-matches
npm run decide -- --match <match_id> --risk balanced --stake-usd 3 --format summary
```

Or through Telegram:

```text
How am I doing?
What games can I still predict?
Analyze match <match_id> with balanced risk and 3 dollars cash.
```

After reviewing saved decisions and smoke-test behavior, the agent owner may switch to approval-required mode:

```text
Set policy approval required.
Approve decision <saved_decision_id>.
```

The approval path still checks duplicate prediction, match payload, cutoff buffer, balance/exposure, policy mode, and confirmation readback before any transaction can be considered safe.

## Reusable Verification

Before handing a user-agent to someone else:

```bash
npm run check
npm run build
npm run telegram-private-smoke -- --format summary
npm run onboarding -- --format summary
```

Then run one private Telegram DM session and verify:

- `/menu` opens tournament-aware controls.
- `How am I doing?` shows the selected tournament and connected wallet.
- `Preview the next open match` returns a personal prediction briefing.
- `Analyze match <id> with balanced risk and 3 dollars cash` works only for the configured admin id.
- `Approve decision <id>` does not execute unless the saved decision exists and the configured personal admin taps the explicit approval button.
