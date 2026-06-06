# SmartCup Personal Agent CLI Reference

Status: personal-agent command reference.

This document tracks the terminal commands available for a non-custodial SmartCup League personal prediction agent. The CLI is the owner-facing technical surface; Telegram should call the same agent logic rather than duplicating prediction behavior.

## Safety Model

- Default policy is `read_only`.
- The agent never needs mnemonics, private keys, wallet JSON, browser sessions, or seed phrases.
- Live prediction execution must require an existing saved report, explicit approval, duplicate checks, cutoff checks, payload checks, balance checks, exposure checks, and confirmation readback.
- Provider tokens belong in `.env` or host environment variables, not committed files.

## Setup

```bash
npm install
npm run check
npm run build
npm run setup-check
```

Optional provider token:

```bash
export FOOTBALL_DATA_API_TOKEN=<your_token>
```

## Daily Read-Only Flow

```bash
npm run sync
npm run profile
npm run onboarding -- --format summary
npm run plan-open-matches
npm run reconcile-predictions -- --format summary
npm run decide -- --match <match_id> --risk balanced --format summary --save true
npm run list-reports -- --limit 10
```

## Match Analysis

```bash
npm run team-rating -- --match <match_id>
npm run pool -- --match <match_id>
npm run crowd -- --match <match_id>
npm run ev -- --match <match_id>
npm run points -- --match <match_id>
npm run leaderboard -- --match <match_id>
npm run opponents
npm run sample-opponents -- --match <match_id>
npm run simulate -- --match <match_id>
npm run recommend -- --match <match_id>
```

## Strategy Layers

```bash
npm run market -- --match <match_id> --format summary
npm run timing -- --match <match_id> --format summary
npm run crowd-map -- --match <match_id> --format summary
npm run context-risk -- --match <match_id> --format summary
npm run position-strategy -- --match <match_id> --format summary
npm run alternatives -- --match <match_id> --format summary
```

What these commands do:

- `market`: compares agent probabilities with bookmaker implied probability when an odds provider is configured.
- `timing`: recommends predict now, wait, or blocked by cutoff.
- `crowd-map`: shows visible public outcome crowding and likely score clusters.
- `context-risk`: summarizes lineup, injury, suspension, and news risk when context data is configured.
- `position-strategy`: recommends leading, mid-table, catch-up, or final-swing posture from rank/points context.
- `alternatives`: shows safest, balanced, contrarian, and leaderboard-upside picks.

## Reports

```bash
npm run list-reports
npm run list-reports -- --tournament worldcup-2026-mvp --limit 10
npm run list-reports -- --match <match_id>
npm run export-report -- --format markdown
npm run export-report -- --format json --limit 5
npm run report
npm run evaluate -- --decision <decision_id> --format summary
```

`export-report` is read-only. It exports saved personal `DecisionReport` records and does not submit transactions.

## Personal Tournament Strategy

```bash
npm run podium -- --format summary
npm run advisory -- --format summary
```

- `podium` builds a personal champion/runner-up/third-place strategy report. Telegram approval can later create a guarded `SubmitPodiumPick` plan when the tournament timing window allows it.
- `advisory` builds a rolling personal tournament plan with priority matches, posture, exposure context, and next actions.

## Wallet Safety, Freebet, And Claim Checks

```bash
npm run freebet -- status --format summary
npm run refund -- status --format summary
npm run claim -- status --format summary
```

These commands are personal wallet-safety checks. They inspect the connected wallet or an explicit public `0x...` address where supported. `refund` is retained as the CLI command name for refund-recovery status, while Telegram presents this area as claim status. These commands must never ask for private wallet material.

## Telegram Smoke Harnesses

```bash
npm run telegram-bot -- --dry-run true
npm run telegram-nl-smoke -- --text "how am I doing?" --format summary
npm run telegram-private-smoke -- --format summary
```

The smoke harnesses do not contact Telegram. They check slash-command priority, natural-language routing, permission gates, approval blocking, report hygiene, and private-message safety.

Useful natural-language test phrases:

```text
show my agent status
what games can I still predict?
preview the next open match
show me a 5 match bundle
show podium strategy
show tournament advisory
analyze competitors and leaderboard for the next open match
show alternative picks for the next open match
should I predict now or wait for the next open match?
set risk to balanced
set policy read only
do I have anything to claim?
```

Expected safety behavior:

- Personal phrases use the connected wallet by default and do not ask for private wallet material.
- Personal admin execution controls require `TELEGRAM_ADMIN_IDS`.
- Natural language can create a saved preview, but cannot submit a transaction by itself.
- `read_only` blocks live execution.

## Live Telegram

```bash
npm run telegram-bot -- --dry-run true
TELEGRAM_MODE=polling npm run telegram-bot
TELEGRAM_MODE=webhook npm run telegram-bot
```

Polling mode requires `TELEGRAM_BOT_TOKEN`. Webhook mode additionally requires `TELEGRAM_WEBHOOK_URL`; `TELEGRAM_WEBHOOK_SECRET` is recommended.

Only one polling or webhook process may use the same Telegram bot token at a time.
