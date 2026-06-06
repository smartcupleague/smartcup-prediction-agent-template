# Manual Telegram Smoke Test

Use this checklist before moving the personal SmartCup prediction agent template to a broader release or official repository.

## Before Testing

- Keep only one Telegram poller active for the same bot token.
- If Render polling is active, stop local terminal polling and macOS `launchd`.
- If testing local fallback, pause the Render worker first. If testing Render, stop local terminal polling and unload/pause launchd for the same bot token.
- Confirm the bot responds to `/start`, `/help`, and `/menu`. Confirm the blue Telegram command popup includes personal-agent commands such as `/menu`, `/agent_status`, `/freebet`, `/claim_status`, `/risk`, `/objective`, and `/strategy`.

## Pre-Install Offline Substitute

If the Telegram bot is not configured yet, run this substitute before the manual test. It does not contact Telegram, but it verifies the local Telegram command/router layer, natural-language parser, permission model, menu isolation, friendly-output hygiene, prediction-alert dedupe, duplicate-approval blocking, and read-only execution blocking.

```bash
npm install
npm run build
node dist/cli.js telegram-bot --dry-run true
node dist/cli.js telegram-private-smoke --format summary --no-save true
```

Expected behavior:

- Dry run reports Telegram mode, token/admin configuration state, webhook settings, alert settings, and public commands without contacting Telegram.
- Private smoke reports all cases passing and says `Contacted Telegram: false`.
- No transaction is submitted, no Telegram message is sent, and no private key or mnemonic is requested.

This substitute is acceptable before a user has created a BotFather token. It does not replace the final manual Telegram test because it cannot prove BotFather token validity, actual chat delivery, inline button rendering in a Telegram client, or Telegram file-upload behavior.

## Menu Structure

Open `/menu` and confirm these top-level sections are visible:

- Predict
- Strategy
- Reports
- Wallet & Safety
- Settings

The menu copy should clearly explain personal flows, read-only actions, and guarded wallet execution.

## Predict

Test these buttons:

- `Predict -> Next Open Match`
- `Predict -> Single Match`
- `Predict -> 5-Match Bundle`
- `Predict -> Podium Strategy`
- `Predict -> Tournament Advisory`
- `Predict -> Competitor Analysis`

Expected behavior:

- Personal flows do not ask for third-party wallet details, private wallet material, or payment details.
- Outputs are friendly and do not show raw terminal logs.
- Decision previews do not auto-submit.
- Any live execution requires a saved report plus explicit approval and passing safety gates.
- `Single Match` and `Next Open Match` show `Approve Agent Pick`, `Change Stake / Value`, and `Enter Score Yourself`. Manual score selection asks for the named home-team score, then the named away-team score. If the submitted score is a knockout draw, it asks for the penalty winner using the team names. The selected score must stay visible, and approval must still block safely if duplicate/cutoff/balance/exposure guards fail.
- `Change Stake / Value` asks for a USD amount such as `3` or `4.50`, converts it to VARA, and then shows a second explicit approval button. Sending the amount must not submit anything by itself.
- `Podium Strategy` shows a preview and an `Approve Podium Pick` button for the personal admin. Before the configured podium window opens, approval must block safely on timing rather than submit.
- `Podium Strategy` also lets the personal admin change champion, runner-up, and third-place through canonical team buttons. Typed team names should not be needed for submission, duplicate teams should be rejected before approval, and `Cancel` should close the podium draft without submitting or approving a transaction plan.

Natural-language phrases:

```text
preview the next open match
analyze competitors and leaderboard for the next open match
show me a 5 match bundle
show podium strategy
show tournament advisory
show alternative picks for the next open match
should I predict now or wait for the next open match?
```

## Strategy

Test:

```text
show my strategy settings
set risk to contrarian
set risk to balanced
change objective to catch up
protect my lead
use final swing strategy
make it conservative and read only
```

Expected behavior:

- Strategy changes persist per Telegram user and tournament.
- Mixed phrases such as `make it conservative and read only` ask for clarification instead of silently changing both prediction risk and execution policy.

## Reports

Test:

```text
show saved reports
show prediction history
sync chain predictions from the Prediction History button
show calibration
export latest report as markdown
export latest report as json
```

Expected behavior:

- Saved report lookup works.
- Saved Decisions first shows recent saved reports as `Open #<match>` buttons.
- Opening one saved report shows the report detail plus `Approve Agent Pick`, `Change Stake / Value`, and `Enter Score Yourself`.
- Opening one saved report also shows `Discard Report`; tapping it must ask for confirmation before removing the report from Saved Decisions.
- Saved-report approval still uses the guarded approval path; it must not submit from the list or detail view alone.
- Saved-report value changes still require the refreshed-value approval button before the guarded executor runs.
- If the tournament has finished/stale reports, Saved Decisions shows `Discard Finished Reports`; tapping it should remove only finished/stale saved previews and must not affect on-chain predictions.
- Prediction History explains that submitted-prediction records come from explicit chain sync/reconciliation, and the `Sync Chain Predictions` button should import live wallet bets without submitting anything.
- Export prompts and completion messages are friendly.
- Markdown and JSON exports arrive as Telegram document attachments with `.md` or `.json` filenames.
- If Telegram file upload fails, the bot explains the upload issue and falls back to sending the export as text chunks.
- Personal replies do not include `npm run`, `tsx`, `SQLite`, stack traces, raw indexer errors, or planck-only EV text.

## Wallet & Safety

Test:

```text
show my agent status
check my freebet balance
do I have anything to claim?
show exposure limits
show execution policy
show data provider status
```

Expected behavior:

- Agent status shows tournament, nickname, wallet, balance with USD conversion, prediction count, and rank/points when available.
- Freebet reports the ledger as missing until the real Freebet Ledger ID is configured.
- Claim status is read-only until explicit claim approval and separates match rewards, final prize, and refund recovery.
- Execution policy should be `approval_required` only for guarded private testing; new template users should start in `read_only`.

## Settings

Test:

```text
change tournament
show risk defaults
show objective defaults
show strategy defaults
show data provider status
```

Expected behavior:

- Tournament context remains explicit.
- Match IDs are not presented without the selected tournament context.

## Safety And Negative Tests

Admin account:

```text
approve the latest prediction
submit my prediction now
```

Expected behavior:

- Natural language must not execute live by itself.
- Execution requires an existing saved decision plus explicit approval and passing safety gates.

Non-admin account:

```text
set execution policy to autopilot
approve latest prediction
```

Expected behavior:

- Denied.

Unsafe wallet prompt input:

```text
my seed phrase is test test test...
```

Expected behavior:

- Rejected. The bot should ask only for a public `0x...` wallet address.

## Prediction Alert Check

Normal behavior:

- Alerts only apply to unpredicted eligible matches.
- The default alert fires when 30 minutes remain before prediction close.
- SmartCup prediction close is 10 minutes before kickoff, so the alert is roughly 40 minutes before kickoff.

Optional forced test:

1. Temporarily set `TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=11000`.
2. Restart the bot.
3. Confirm one alert arrives.
4. Restore `TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES=30`.

Only use the forced test if you are comfortable receiving a real test alert now.
