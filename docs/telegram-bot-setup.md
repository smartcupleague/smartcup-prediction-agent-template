# SmartCup Prediction Agent Telegram Bot Setup

Purpose: configure the Telegram bot shell for a personal SmartCup prediction agent without exposing wallet keys or user secrets.

## Can We Configure It Through BotFather?

Yes. BotFather is where we create the Telegram bot identity and receive the bot token.

Use BotFather for:

- creating the bot
- choosing the bot username
- getting the bot token
- setting display name, description, about text, avatar, and command list
- setting privacy/group behavior if the bot is added to groups

Use `.env` for:

- bot token
- admin Telegram ids
- polling or webhook mode
- webhook URL
- bot public name used in local messages

Do not put wallet private keys, mnemonics, browser wallet sessions, or user secrets in BotFather or `.env`.

## BotFather Setup

1. Open Telegram and chat with `@BotFather`.
2. Create a new bot with `/newbot`.
3. Choose display name:

   ```text
   Your SmartCup Agent
   ```

4. Choose username, for example:

   ```text
   your_smartcup_agent_bot
   ```

5. Copy the bot token into local `.env`:

   ```text
   TELEGRAM_BOT_TOKEN=<botfather_token>
   ```

6. Set bot description:

   ```text
   Your personal SmartCup agent provides non-custodial SmartCup League prediction reports. You keep custody and sign your own SmartCup transactions.
   ```

7. Set about text:

   ```text
   Personal SmartCup League prediction reports and guarded wallet-action planning. No custody. No guaranteed results.
   ```

8. Set command list:

   ```text
   start - Start SmartCup agent
   menu - Open guided SmartCup agent menu
   help - Show commands and safety rules
   agent_status - Show connected wallet and tournament status
   freebet - Check freebet status
   claim_status - Check claimable rewards
   risk - Show or set prediction risk default
   objective - Show or set simulation objective default
   strategy - Show or set strategy posture default
   ```

The blue Telegram command popup should stay personal-agent first. List only commands that help the owner run their own agent.

The bot also publishes this public command list through Telegram `setMyCommands` on startup in polling or webhook mode. Use BotFather as the manual fallback if the command popup does not update immediately after a deploy or restart.

Admin commands should not be listed publicly. They are still accepted by the bot only for configured admins.

## Local Environment

Add these values to `.env`:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=
TELEGRAM_MODE=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_HOST=0.0.0.0
TELEGRAM_WEBHOOK_PORT=8787
TELEGRAM_WEBHOOK_SECRET=
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_bot_display_name>
TELEGRAM_PREDICTION_ALERTS_ENABLED=true
TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30
TELEGRAM_PREDICTION_ALERT_SCAN_MS=300000
TELEGRAM_PREDICTION_ALERT_CHAT_IDS=
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
```

Field meanings:

- `TELEGRAM_BOT_TOKEN`: token issued by BotFather.
- `TELEGRAM_ADMIN_IDS`: comma-separated numeric Telegram user ids allowed to run admin commands.
- `TELEGRAM_MODE`: `polling` for local development or `webhook` for deployment.
- `TELEGRAM_WEBHOOK_URL`: public HTTPS webhook endpoint when using webhook mode.
- `TELEGRAM_WEBHOOK_HOST`: local bind host for the webhook HTTP server.
- `TELEGRAM_WEBHOOK_PORT`: local bind port for the webhook HTTP server.
- `TELEGRAM_WEBHOOK_SECRET`: optional Telegram webhook secret token checked against `X-Telegram-Bot-Api-Secret-Token`.
- `SMARTPREDICTOR_PUBLIC_BOT_NAME`: display name used in bot copy.
- `TELEGRAM_PREDICTION_ALERTS_ENABLED`: enables or disables cutoff reminders.
- `TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES`: minutes before SmartCup prediction close to send the reminder. Default `30`.
- `TELEGRAM_PREDICTION_ALERT_SCAN_MS`: how often the running bot scans eligible matches. Default `300000` ms.
- `TELEGRAM_PREDICTION_ALERT_CHAT_IDS`: optional comma-separated Telegram chat ids for reminders. When empty, reminders go to `TELEGRAM_ADMIN_IDS`.
- `SMARTPREDICTOR_REUSABLE_SETUP_GUARD`: in production, refuses to start deployments that still use template/default wallet or bot identity values.
- `SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY`: set to `true` only for deliberate local documentation/demo smoke runs with placeholder identity values.

## Admin Ids

The full permission model is documented in `docs/telegram-permissions.md`.

Admin commands must use Telegram numeric user ids, not display names or handles.

Ways to find an id during template testing:

- add a temporary `/whoami` bot command when implementation starts
- use a trusted Telegram id helper bot
- inspect Telegram update payloads in local polling logs

Example:

```text
TELEGRAM_ADMIN_IDS=123456789,987654321
```

## Polling vs Webhook

The default Telegram path is polling. Start locally, then optionally move to a hosted polling worker.

### Default: Local Polling

Use this for first setup and debugging:

```text
TELEGRAM_MODE=polling
```

Polling fits:

- local terminal testing
- first private Telegram smoke tests
- macOS `launchd` supervision
- Render Background Worker hosting after local setup works

Polling tradeoffs:

- one bot token should have only one active polling process
- the process must stay running
- use launchd or Render only after local polling is understood

Run a config dry-run without contacting Telegram:

```bash
npm run telegram-bot -- --dry-run true
```

Run local polling after `TELEGRAM_BOT_TOKEN` is set:

```bash
TELEGRAM_MODE=polling npm run telegram-bot
```

### Optional Local Continuity: macOS launchd

Use launchd only after local polling works. It keeps the same local `.env` and restarts the bot after crashes, terminal closes, or Mac login/reboot.

### Advanced Hosted: Render Background Worker Polling

Use this when the bot should stay online without your laptop. It requires Render env vars, a persistent disk for SQLite memory, and the one-poller rule.

### Most Advanced Hosted: Render Web Service Webhook

Webhook mode is the later production-style path:

```text
TELEGRAM_MODE=webhook
```

Use webhook only after polling is stable and you understand public HTTPS routing, webhook secret validation, Telegram webhook registration, deployment logs, and operational monitoring.

Webhook tradeoffs:

- needs a public HTTPS endpoint
- needs secret validation and route hygiene
- has more moving pieces to debug than polling

## Prediction Window Alerts

The bot can remind the personal admin when an eligible match is close to prediction close.

Default behavior:

- SmartCup prediction close is 10 minutes before kickoff.
- `TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30` sends the reminder about 30 minutes before that close.
- With the default SmartCup close, this means the alert arrives about 40 minutes before kickoff.
- Alerts are sent only for eligible open matches that the connected wallet has not already predicted.
- Each alert is stored in local memory/SQLite, so the same chat/tournament/match/lead-time reminder is not sent twice after restarts.

Example alert:

```text
Prediction window alert

Tournament: SmartCup League World Cup 2026 template
Match #4: United States vs Paraguay
Phase: Group Stage

SmartCup prediction closes at: 2026-06-13T00:50:00.000Z
Kickoff: 2026-06-13T01:00:00.000Z
Reminder: about 30 minutes remain before the SmartCup prediction close.

Next action
Ask for "preview match 4" or open /menu -> Predict -> Single Match.
```

Use `TELEGRAM_PREDICTION_ALERT_CHAT_IDS` only when the alert destination differs from `TELEGRAM_ADMIN_IDS`. The bot can only send a private reminder to a Telegram user who has already started the bot.

## macOS LaunchAgent For Private Polling

Use this when you want the private polling bot to keep running after the terminal closes, restart after crashes, and start again after Mac login/reboot.

Before installing:

- Confirm `.env` exists and includes `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS`, `TELEGRAM_MODE=polling`, and the SmartCup agent config.
- Stop any local terminal polling process for the same bot token.
- Pause any Render polling worker for the same bot token.
- Build the production CLI.

Install:

```bash
npm install
npm run build
npm run telegram-bot -- --dry-run true
npm run telegram-bot:launchd:install
```

The installer creates this user LaunchAgent:

```text
~/Library/LaunchAgents/com.smartcup.prediction-agent.telegram.plist
```

It sources the project `.env` at runtime, so the Telegram token stays out of the plist and out of Git. Logs are written locally:

```text
logs/launchd/telegram-bot.out.log
logs/launchd/telegram-bot.err.log
```

Check status:

```bash
launchctl print gui/$(id -u)/com.smartcup.prediction-agent.telegram
tail -n 80 logs/launchd/telegram-bot.err.log
tail -n 80 logs/launchd/telegram-bot.out.log
```

Restart after editing `.env` or rebuilding:

```bash
launchctl kickstart -k gui/$(id -u)/com.smartcup.prediction-agent.telegram
```

Uninstall:

```bash
npm run telegram-bot:launchd:uninstall
```

Optional overrides:

```bash
SMARTPREDICTOR_LAUNCHD_LABEL=com.smartcup.my-agent.telegram npm run telegram-bot:launchd:install
SMARTPREDICTOR_ENV_FILE=/absolute/path/to/.env npm run telegram-bot:launchd:install
SMARTPREDICTOR_LAUNCHD_LOG_DIR=/absolute/path/to/logs npm run telegram-bot:launchd:install
```

If you install with a custom `SMARTPREDICTOR_LAUNCHD_LABEL`, use that label in `launchctl print` and `launchctl kickstart`.

Polling warning: one Telegram bot token should have only one active polling process. Do not run terminal polling, macOS `launchd`, and Render polling at the same time for the same bot token.

Use webhook later only as the most advanced hosted path:

```text
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://example.com/api/telegram/webhook
TELEGRAM_WEBHOOK_HOST=0.0.0.0
TELEGRAM_WEBHOOK_PORT=8787
TELEGRAM_WEBHOOK_SECRET=<optional_secret>
```

Webhook mode requires a public HTTPS URL. Do not use webhook mode until the hosting target is chosen and polling has been stopped for the same bot token.

Run webhook mode:

```bash
TELEGRAM_MODE=webhook npm run telegram-bot
```

The runner registers the webhook URL with Telegram, starts a local HTTP server, and routes Telegram message updates into the same user and personal-admin handlers used by the CLI harnesses. Webhook updates are processed serially to avoid local SQLite write races under concurrent Telegram deliveries.

## Render Background Worker Polling

For the advanced hosted path, use Render Background Worker polling after local setup is stable. It avoids manual terminal restarts while keeping the bot architecture simpler than webhook mode.

Render service settings:

```text
Service type: Background Worker
Root directory: leave blank for a standalone repo; use the project subfolder only in a monorepo
Build command: npm ci --include=dev && npm run build
Start command: TELEGRAM_MODE=polling npm run telegram-bot:prod
```

Persistent storage is required for Saved Decisions, report export, runtime policy changes, Telegram preferences, and prediction alerts to survive Render restarts or redeploys. Add the disk before the first production deploy if you want stable saved-report behavior.

Render disk settings:

```text
Disk name: smartcup-agent-memory
Mount path: /var/data
Minimum size: 1 GB
```

Then set:

```text
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
```

Without the disk, the bot can still answer live reads and generate previews, but saved `DecisionReport` records may disappear after the worker restarts. The visible symptom is `Export Report` saying the bot has `0` saved reports even after you generated previews earlier.

Recommended policy while deploying:

```text
SMARTPREDICTOR_POLICY_MODE=read_only
```

Switch to `approval_required` only after private smoke tests pass and the personal admin has confirmed wallet execution is safe in the hosted runtime.

`SMARTPREDICTOR_POLICY_MODE` is the startup fallback. Personal admin changes from the policy command/menu are also stored as a durable runtime-policy record in local memory/SQLite, so Render/local restarts can reload the latest personal admin-selected mode when the same persisted state is available. If the Render service is rebuilt with no persisted state, it falls back to the Render env var.

Minimum Render env vars:

```text
NODE_ENV=production
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_user_ids>
TELEGRAM_MODE=polling
TELEGRAM_PREDICTION_ALERTS_ENABLED=true
TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30
SMARTPREDICTOR_PUBLIC_BOT_NAME=<your_bot_display_name>
SMARTPREDICTOR_REUSABLE_SETUP_GUARD=true
SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=false
SMARTPREDICTOR_POLICY_MODE=read_only
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
SMARTCUP_TOURNAMENT_PROFILE_PATH=tournaments/worldcup-2026.mvp.json
SMARTCUP_BOLAO_CORE_ID=<bolao_core_program_id>
SMARTCUP_ORACLE_ID=<oracle_program_id>
SMARTCUP_INDEXER_GRAPHQL_URL=<hosted_graphql_url>
SMARTCUP_API_URL=<smartcup_api_url>
SMARTPREDICTOR_WALLET_ACCOUNT=<wallet_account_name>
SMARTPREDICTOR_WALLET_HEX=<0x_public_wallet>
SMARTPREDICTOR_WALLET_SS58=<ss58_public_wallet>
SMARTPREDICTOR_MIN_STAKE_USD=3
SMARTPREDICTOR_MAX_STAKE_USD=5
SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_USD=100
```

Do not add mnemonics, private keys, browser sessions, or wallet JSON to Render environment variables.

Operational notes:

- Stop the local polling bot before starting the Render worker.
- Check Render logs after deploy for startup messages and Telegram polling errors.
- After generating one saved preview, restart the worker and confirm Saved Decisions still lists it; this verifies the persistent disk path.
- Pause the Render worker before switching to webhook mode.
- Keep hosted live signing disabled unless guarded execution has been separately reviewed.

### Example Render Worker

Template deployment example:

```text
Render service name: <your-render-worker-name>
Service type: Background Worker
Repository: smartcupleague/smartcup-prediction-agent-template
Branch: main
Build command: npm ci --include=dev && npm run build
Start command: TELEGRAM_MODE=polling npm run telegram-bot:prod
Recommended startup policy mode: read_only
Current runtime policy mode: controlled by the policy command/menu and persisted local runtime policy when storage is available
```

Background Workers do not expose a public HTTP URL. The operational URL is the Render dashboard page for the worker. Use it for deploy logs, live logs, pause/suspend, restart, and manual redeploy actions.

Render log location:

```text
Render Dashboard -> <your-render-worker-name> -> Logs
```

Expected healthy startup log markers:

```text
[<agent_handle>] command=telegram-bot
[<agent_handle>] runtime_policy=read_only source=...
Telegram polling started
```

Expected ongoing health markers:

```text
Telegram polling heartbeat
```

Pause or suspend procedure:

1. Open the `<your-render-worker-name>` Background Worker in Render.
2. Use Render's pause/suspend control for the service.
3. Confirm logs stop showing polling heartbeats.
4. Only after the hosted worker is paused, start a local terminal or `launchd` polling fallback for the same bot token.

Restart procedure:

1. Open the `<your-render-worker-name>` Background Worker in Render.
2. Use Render's restart control, or trigger a manual deploy from the latest `main` commit.
3. Watch logs until the startup markers and polling heartbeat appear.
4. Send `/agent_status` or `/menu` in Telegram to confirm the worker is responding.

Redeploy procedure after code changes:

1. Commit and push to `origin/main`.
2. Let Render auto-deploy, or trigger `Manual Deploy` from the Render service page.
3. Confirm the build uses `npm ci --include=dev && npm run build`.
4. Confirm runtime logs show the bot starting in polling mode.

Rollback procedure:

1. Pause the worker if Telegram responses are unsafe, duplicated, or confusing.
2. In Render, redeploy the last known-good commit.
3. Keep `SMARTPREDICTOR_POLICY_MODE=read_only` during emergency rollback unless the approval flow is being deliberately tested.
4. Resume the worker and verify `/agent_status`, `/menu`, and a personal-admin read-only phrase.

One-poller rule:

- Render polling, local terminal polling, and macOS `launchd` polling must not run at the same time for the same bot token.
- If Telegram logs mention another `getUpdates` session or polling conflict, pause one of the pollers immediately.
- Keep a local terminal or macOS `launchd` fallback available, but only start it after the Render worker is paused.

## Render Webhook Later

Webhook is the later production option once commands and natural language are stable.

Recommended service shape:

```text
Service type: Web Service
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://<service>.onrender.com/<telegram-webhook-path>
TELEGRAM_WEBHOOK_SECRET=<random_secret>
```

Webhook advantages:

- Telegram pushes updates to the service.
- Better long-term shape for production uptime and observability.

Webhook tradeoffs:

- Requires a public HTTPS endpoint.
- Requires secret-token validation.
- More moving pieces than polling.
- Must ensure no second polling process is active for the same token.

## Group Privacy

For the template, prefer direct messages with the bot.

If adding the bot to Telegram groups:

- keep personal wallet status and execution actions in private DM
- do not post private scoreline previews in groups unless the personal admin explicitly wants that behavior
- restrict personal admin commands by numeric Telegram user id
- consider keeping BotFather privacy mode enabled unless group message monitoring is explicitly needed

The current runner refuses personal admin actions outside private DMs. Prefer private DMs for the full personal-agent workflow.

## Natural-Language Use

The bot accepts common natural-language phrases in private DMs. Slash commands still have priority, so `/menu`, `/agent_status`, `/risk`, `/objective`, `/strategy`, and other exact commands always route through their command handlers first.

Personal examples:

```text
How am I doing?
Show my stats for the World Cup.
What games can I still predict?
Preview the next open match.
Show me the next five open matches.
Check my freebet balance.
Do I have anything to claim?
```

Personal admin examples:

```text
Analyze match 4 with balanced risk and 3 dollars cash.
Prepare a prediction for the next open match using contrarian mode.
Tournament position strategy for the next open match.
Should I protect lead or catch up for match 4?
Show alternative picks for the next open match.
Give me safest balanced contrarian and leaderboard upside picks for match 4.
What are the four pick options for the next open match?
Show execution policy.
Set policy read only.
Approve decision decision-3-balanced-2-1-1780502534986.
```

Strategy preference slash commands:

```text
/risk show
/risk set contrarian
/objective show
/objective set catch_up
/strategy show
/strategy set protect_lead
```

Non-technical users can use `/menu`, choose the tournament, open `Settings`, and tap `Risk Defaults`, `Objective Defaults`, or `Strategy Defaults` instead of memorizing these commands. `Risk Defaults` change normal match-preview pick style, `Objective Defaults` change competitor/leaderboard simulation ranking, and `Strategy Defaults` change broader tournament posture for advisory and next-action planning.

The guided `/menu` is organized into five top-level sections:

- `Predict`: personal single match, 5-match bundle, podium strategy, tournament advisory, and competitor analysis.
- `Strategy`: saved risk/objective/strategy posture controls, plus read-only timing, position, and alternative-pick analysis.
- `Reports`: saved decisions, prediction history, calibration, and export report.
- `Wallet & Safety`: agent status, freebet checks, claim status, guarded claim-pending approval, and execution policy.
- `Settings`: tournament switching, defaults, and execution controls.

For the personal-agent template, use `Predict`. It does not ask for a third-party public wallet, does not create service requests, and does not charge anything. Single-match previews and the personal 5-match bundle save `DecisionReport` records only; live submission still requires the explicit `Approve Plan` button and the configured policy guards.

To act later on a saved report, open `Reports -> Saved Decisions`. The list first shows `Open #<match>` buttons for recent saved reports. Open the report you want to review; the detail view then shows `Approve Agent Pick`, `Change Stake / Value`, `Enter Score Yourself`, and `Discard Report`. `Change Stake / Value` asks for a USD value such as `3` or `4.50`, converts it to VARA, and then shows a second explicit approval button. Typing the amount does not submit a transaction. `Discard Report` asks for confirmation and removes only the saved preview from the active report list; it does not cancel or reverse an on-chain SmartCup prediction. When the list contains finished or stale match reports, `Saved Decisions` also shows `Discard Finished Reports` so old previews do not pile up. The approval and manual-score buttons reuse the same guarded flows as a fresh preview and re-check duplicate prediction, cutoff timing, payload validity, wallet balance, stake cap, tournament exposure, and execution policy before any live transaction can be sent.

## Friendly Output Expectations

Personal Telegram replies should look like clear user briefings, not terminal output. A healthy personal prediction response includes:

- selected tournament and match context
- recommended score and risk mode
- home/draw/away win probabilities
- exact-score probability
- expected tournament-points explanation
- payout ROI as a percentage, not raw EV jargon
- VARA amounts with USD conversion when a price snapshot is available
- source-quality or degraded-read warnings in plain language
- clear next action

Report exports are the exception to the short-message rule: `Export Report` sends a friendly completion note plus a downloadable Telegram document. Markdown exports use a `.md` filename; JSON exports use a `.json` filename. If Telegram file upload fails, the bot explains the upload issue and falls back to text chunks.

Example single-match preview shape:

```text
Prediction preview
No transaction was submitted.

Match #4: United States vs Paraguay
Recommended pick: United States 2-1 Paraguay
Risk mode: Balanced
Confidence: Medium

Why this pick
- Win/draw probabilities: United States 47.2%; draw 24.4%; Paraguay 28.4%.
- Exact 2-1 probability: 8.1%.

Points view
- Expected tournament value: 0.70 points.
- This is the model average across exact-score, outcome-only, and wrong-result scenarios.

Money / payout view
- Cash payout EV is -90.9% ROI.
- Capital at risk: 4.50 VARA (~USD 1.13 at 0.25 USD/VARA).

Next action
Review the recommendation. Use Approve Plan only if you want guarded wallet execution.
```

Example friendly fallback:

```text
Live source unavailable

What is unavailable:
- Hosted indexer: opponent history and leaderboard enrichment may be incomplete.

What the agent will do:
- Continue with direct chain state and local memory when safe.
- Rerun after the hosted source recovers if this decision depends on crowd or opponent reads.
```

Telegram-facing personal replies should not include raw `npm run` commands, `tsx`, `SQLite` warnings, stack traces, raw `prepared statement` errors, raw `vara-wallet --json call` logs, or planck-only expected-value text. Run `npm run telegram-private-smoke -- --format summary` after bot copy changes; the suite includes a friendly-output hygiene assertion.

Strategy preference natural-language examples:

```text
Set risk to contrarian.
Use conservative mode.
Change objective to catch up.
Protect my lead.
Use final swing strategy.
Show my strategy settings.
```

Saved preferences are used when a decision preview, report, or competitor simulation does not specify risk/objective/strategy. Explicit message values override the saved default for that command.

Strategy modes:

| Mode | What it changes | Example |
| --- | --- | --- |
| `conservative` | Recommendation style favors safer picks | `set risk to conservative` |
| `balanced` | Default recommendation style | `use balanced mode` |
| `contrarian` | Recommendation style searches harder for differentiated upside | `set risk to contrarian` |
| `catch_up` | Simulation objective favors rank-climbing upside | `change objective to catch up` |
| `protect_lead` | Strategy posture favors protecting current rank | `protect my lead` |
| `final_swing` | Strategy posture favors late-tournament upside | `use final swing strategy` |

Execution policy is different from strategy. Policy controls whether the personal agent may plan or execute guarded wallet actions; it does not change football prediction reasoning.

Policy examples:

```text
Show execution policy.
Set policy read only.
Set policy approval required.
Set policy claim only.
```

Use strategy phrases for prediction behavior and policy phrases for wallet-action permissions:

| User means | Say this | Do not rely on |
| --- | --- | --- |
| Safer prediction style | `set risk to conservative` | `make it conservative` |
| No wallet-action execution | `set policy read only` | `make it read only` |
| Rank-climbing simulations | `change objective to catch up` | `make it aggressive` |
| Protect rank lead | `protect my lead` | `be careful` |

Ambiguous phrases such as `make it conservative` or mixed phrases such as `make it conservative and read only` ask for clarification and do not change settings.

Safety behavior:

- Personal phrases only route to read-only status, previews, reports, freebet, claim status, or guided menu flows.
- Personal admin phrases require the sender's numeric Telegram id to be listed in `TELEGRAM_ADMIN_IDS`.
- Ambiguous phrases such as `Analyze with balanced risk` ask for clarification when match or tournament context is missing.
- Ambiguous policy-vs-strategy phrases ask for clarification before changing any setting.
- Approval phrases do not execute directly. They require an existing saved `DecisionReport` and an explicit `Approve Plan` button callback.
- The bot stores parser telemetry as hashes and structured metadata, not raw natural-language message text.

Local natural-language smoke checks:

```bash
npm run telegram-nl-smoke -- --text "how am I doing?" --format summary
npm run telegram-private-smoke -- --format summary
```

Run these before private Telegram testing after changing parser, menu, approval, or policy code.

## Safety Copy

Use this text in `/start`, `/help`, prediction previews, reports, and wallet-safety messages:

```text
Your SmartCup prediction agent gives non-custodial recommendations only. You sign SmartCup transactions with your own wallet. Never share your seed phrase, private key, wallet session, or keystore. No result, payout, rank, or profit is guaranteed.
```

## Implementation Requirements

The current bot runner in `src/bot/telegram-runner.ts`:

- uses built-in Node `fetch` plus `http` so the template can run without extra dependencies
- read config from `.env`
- refuse to start if `TELEGRAM_BOT_TOKEN` is missing
- parse `TELEGRAM_ADMIN_IDS` into a strict allowlist
- reject admin commands from non-admin users
- reject personal admin commands outside private DMs
- call existing agent modules instead of shelling out where possible
- process webhook updates serially to avoid SQLite write races
- never log private report content in public channels

The earlier implementation decision preferred `grammy`; that remains a future polish path if we need richer Telegram middleware. The first working runner is dependency-light and routes to the already-tested command handlers.

Implementation decision note: `docs/telegram-implementation-decision.md`.

## Next Step

After this config doc, set `TELEGRAM_BOT_TOKEN`, add your numeric Telegram id to `TELEGRAM_ADMIN_IDS`, run `npm run telegram-bot -- --dry-run true`, then start polling mode for local tests.
