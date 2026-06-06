# Telegram Bot Command Map

This is the personal-agent Telegram map for the SmartCup League prediction agent template. It covers only the flows needed for an owner to run their own non-custodial agent.

## Public Slash Commands

Configure these with BotFather or let the bot publish them on startup:

```text
start - Start the personal SmartCup agent
menu - Open guided SmartCup menu
help - Show commands and safety rules
agent_status - Show connected wallet and tournament status
freebet - Check freebet status
claim_status - Check claimable rewards
risk - Show or set prediction risk default
objective - Show or set simulation objective default
strategy - Show or set strategy posture default
```

Do not publish internal approval commands in the public Telegram command popup. Approval actions remain gated by `TELEGRAM_ADMIN_IDS` and explicit buttons/commands.

## Menu Architecture

`/menu` should show these top-level sections:

- `Predict`
- `Strategy`
- `Reports`
- `Wallet & Safety`
- `Settings`

Each reply should name the selected tournament so match ids are never ambiguous.

## Predict

Personal prediction flows use the connected agent wallet by default. They do not collect third-party wallet details, do not create service records, and do not charge anything.

Buttons:

- `Next Open Match`
- `Single Match`
- `5-Match Bundle`
- `Podium Strategy`
- `Tournament Advisory`
- `Competitor Analysis`

Expected behavior:

- `Next Open Match` resolves the next eligible unpredicted open match for the selected tournament.
- `Single Match` lets the agent owner pick an eligible match and saves a personal `DecisionReport`.
- `5-Match Bundle` resolves the next five eligible open matches and saves one personal report per match.
- `Podium Strategy` renders champion, runner-up, and third-place strategy. Guarded `SubmitPodiumPick` execution requires explicit approval and a valid timing window.
- `Tournament Advisory` is read-only rolling strategy.
- `Competitor Analysis` is read-only leaderboard simulation.

Saved match previews should offer:

- `Approve Agent Pick`
- `Change Stake / Value`
- `Enter Score Yourself`
- `Discard Report`

Manual score entry asks for the named home-team score, then the named away-team score. If a knockout score is a draw, the bot asks for the penalty winner using the team names.

## Strategy

Buttons:

- `Risk / Strategy Settings`
- `Timing Strategy`
- `Position Strategy`
- `Alternative Picks`

Risk, objective, and strategy are different:

- Risk default changes normal match-preview pick style.
- Objective default changes competitor/leaderboard simulation ranking.
- Strategy default changes broader tournament posture for advisory and next-action planning.

Natural-language examples:

```text
show my strategy settings
set risk to contrarian
set risk to balanced
change objective to catch up
protect my lead
use final swing strategy
make it conservative and read only
```

Mixed phrases such as `make it conservative and read only` should ask for clarification because they combine prediction style and execution policy.

## Reports

Buttons:

- `Saved Decisions`
- `Prediction History`
- `Calibration`
- `Export Report`

Expected behavior:

- `Saved Decisions` lists recent personal reports as openable buttons.
- Opening a saved report shows detail and approval/manual-score/discard actions.
- `Prediction History` summarizes local submitted-prediction records, synced chain predictions, saved reports, and evaluations.
- `Calibration` reports predicted probability versus actual result after finalized outcomes are evaluated.
- `Export Report` sends Markdown or JSON as Telegram document attachments where supported.

Report actions are read-only unless the configured personal admin taps an explicit approval button on a saved decision.

## Wallet & Safety

Buttons:

- `Agent Status`
- `Freebet Status`
- `Claim Status`
- `Exposure / Stake Limits`
- `Execution Policy`
- `Data Provider Status`

Expected behavior:

- `Agent Status` shows tournament, nickname, wallet, balance with USD conversion when available, prediction count, and rank/points when available.
- `Freebet Status` explains when `FREEBET_LEDGER_PROGRAM_ID` is missing.
- `Claim Status` checks wallet-owned match rewards, final prize, and eligible refund/claim recovery actions.
- `Exposure / Stake Limits` shows USD and VARA context.
- `Execution Policy` shows `read_only`, `approval_required`, `claim_only`, or `tournament_autopilot`.

## Settings

Buttons:

- `Change Tournament`
- `Risk Defaults`
- `Objective Defaults`
- `Strategy Defaults`
- `Data Provider Status`

`Change Tournament` should be easy to reach. When more than one tournament is configured, the bot should show canonical tournament names and ids.

## Natural-Language Routing

Slash commands keep priority over natural-language parsing.

Supported personal phrases:

```text
show me the menu
open menu options
show my agent status
what games can I still predict?
preview the next open match
pick match 4
show me a 5 match bundle
show podium strategy
show tournament advisory
analyze competitors and leaderboard for the next open match
show alternative picks for the next open match
should I predict now or wait for the next open match?
show saved reports
export latest report as markdown
export latest report as json
check my freebet balance
do I have anything to claim?
show execution policy
set policy read only
set policy approval required
```

Safety rules:

- Natural language can create a saved preview.
- Natural language cannot submit a prediction by itself.
- Live execution requires an existing saved report plus an explicit approval button or approved personal-admin command.
- Personal-admin actions require the sender id to be listed in `TELEGRAM_ADMIN_IDS`.
- Unsafe wallet text such as seed phrases, private keys, wallet JSON, or browser sessions must be rejected.

## Friendly Output Rules

Telegram replies should not expose raw command logs or internal errors.

Avoid:

- raw `npm run` command output
- `tsx` traces
- `SQLite` warnings
- stack traces
- raw indexer `prepared statement` errors
- raw `vara-wallet --json call` logs
- planck-only EV text

Prefer:

- clear match and tournament context
- percentages for probabilities and ROI
- VARA amounts with USD conversion when available
- plain-language uncertainty labels
- a clear next action

## Smoke Tests

```bash
npm run telegram-bot -- --dry-run true
npm run telegram-nl-smoke -- --text "show me the menu" --format summary
npm run telegram-private-smoke -- --format summary
```

The private smoke suite should pass before sharing the bot with another user.
