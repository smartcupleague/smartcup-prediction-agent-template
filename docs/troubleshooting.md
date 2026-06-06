# Troubleshooting

Use this guide when the personal SmartCup prediction agent fails setup checks, Telegram replies, saved reports, provider reads, or wallet-safety checks.

The safe default is always `SMARTPREDICTOR_POLICY_MODE=read_only`. Do not move to guarded execution until the relevant check passes.

## Quick Triage

Run these first:

```bash
npm run setup-check
npm run check
npm run build
npm run telegram-bot -- --dry-run true
npm run telegram-private-smoke -- --format summary
```

Check these basics:

- `.env` exists and was copied from `.env.example`.
- Placeholder wallet, bot, and admin values were replaced.
- No mnemonic, private key, wallet JSON, browser session, or SubWallet export is present in `.env`, Render, Telegram, or Git.
- Only one Telegram poller is active for the bot token.
- The selected tournament profile and program ids match the active SmartCup tournament.

## `vara-wallet`

Symptoms:

- `vara-wallet` command not found.
- Setup checks cannot read wallet or chain state.
- Chain reads fail with module errors such as missing package dependencies.
- Telegram eligible-match picker cannot load live SmartCup state.

Checks:

```bash
which vara-wallet || true
vara-wallet --version || true
vara-wallet wallet list || true
npm exec --yes --package=vara-wallet -- vara-wallet --version
npm run setup-check
```

Fixes:

- Prefer `npm exec --yes --package=vara-wallet -- vara-wallet ...` if the global install is unstable.
- If you use a global binary, set it explicitly:

  ```text
  VARA_WALLET_BIN=/usr/local/bin/vara-wallet
  ```

- Confirm `VARA_RPC_URL` points to the intended network, for example Vara mainnet RPC.
- Re-run `npm run setup-check` after changing wallet or RPC settings.

Safety notes:

- The agent needs only public wallet identity and local wallet command access.
- Never paste a seed phrase, mnemonic, private key, wallet JSON, or browser session into this project.

## Telegram Bot Token And Admin Id

Symptoms:

- Render or local bot logs say `TELEGRAM_BOT_TOKEN is required`.
- Bot does not reply to `/start` or `/menu`.
- Personal admin actions are denied.
- Telegram command popup is stale or missing `/menu`.

Checks:

```bash
npm run telegram-bot -- --dry-run true
npm run telegram-private-smoke -- --format summary
```

Confirm `.env` or Render env vars include:

```text
TELEGRAM_BOT_TOKEN=<botfather_token>
TELEGRAM_ADMIN_IDS=<numeric_telegram_user_id>
TELEGRAM_MODE=polling
```

Fixes:

- Get the token from `@BotFather`, not from a helper bot.
- Use your numeric Telegram user id in `TELEGRAM_ADMIN_IDS`, not your username and not the bot id.
- Send `/start` to the bot once before expecting alerts or private replies.
- Use BotFather to set the public command list if Telegram does not refresh it automatically.
- Keep only one poller active: local terminal, macOS `launchd`, Render polling, or webhook, never more than one.

Safety notes:

- Treat `TELEGRAM_BOT_TOKEN` as a secret.
- Admin id is not secret, but it controls who can approve guarded actions.

## Render Persistent Disk

Symptoms:

- Saved Decisions disappear after restart or redeploy.
- Export Report says there are `0` saved reports after previews were generated.
- Runtime policy, Telegram preferences, or prediction alerts reset after deploy.

Checks:

Render Background Worker settings should include a persistent disk:

```text
Disk mount path: /var/data
SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite
```

Verification:

1. Generate one personal prediction preview.
2. Open `Reports -> Saved Decisions` and confirm it appears.
3. Restart the Render worker.
4. Open `Reports -> Saved Decisions` again.
5. If the report is still visible, the persistent disk path is working.

Fixes:

- Add a Render disk before relying on saved reports in hosted mode.
- Set `SMARTPREDICTOR_SQLITE_PATH` to the disk mount path, not a relative path inside the ephemeral app directory.
- Redeploy or restart the worker after changing env vars.

Safety notes:

- Do not put mnemonics, private keys, browser sessions, or wallet JSON in Render env vars.
- Start Render deployments in `read_only`.

## Local Memory And Saved Reports

Symptoms:

- `Saved Decisions` is empty.
- `Export Report` cannot find a saved report.
- Prediction History shows saved reports but no submitted-prediction records.
- Manual local memory and chain truth are out of sync.

Checks:

```bash
npm run list-reports
npm run report
npm run sync
npm run reconcile-predictions -- --format summary
```

Confirm `.env` has a stable memory path when needed:

```text
SMARTPREDICTOR_SQLITE_PATH=data/smartcup-agent.memory.sqlite
```

How to read the behavior:

- Saved `DecisionReport`s are model previews, not proof of submitted chain predictions.
- Submitted-prediction history updates from explicit agent submissions or chain sync/reconciliation.
- Export requires at least one saved report visible to the current bot instance and SQLite file.

Fixes:

- Generate a preview with `--save true` or through Telegram Predict flows.
- Run `sync` and `reconcile-predictions` after manual on-chain predictions.
- Use a persistent SQLite path for hosted or supervised runs.

Safety notes:

- Deleting or discarding a saved report removes a local preview only.
- It does not cancel, reverse, or modify an on-chain SmartCup prediction.

## Indexer GraphQL

Symptoms:

- Competitor analysis has degraded confidence.
- Opponent history, leaderboard enrichment, or bet-history features are incomplete.
- Warnings mention indexer timeout, unavailable GraphQL, or prepared-statement conflicts.

Checks:

```bash
npm run setup-check
npm run opponents
npm run simulate -- --match <match_id> --format summary
```

If you have a hosted GraphQL URL:

```bash
curl -s -X POST "$SMARTCUP_INDEXER_GRAPHQL_URL" \
  -H 'content-type: application/json' \
  --data '{"query":"{ __typename }"}'
```

Fixes:

- Confirm `SMARTCUP_INDEXER_GRAPHQL_URL` points to the GraphQL endpoint, usually ending in `/graphql`.
- Confirm the indexer worker/backfill is running and using the same database as the GraphQL service.
- If the indexer is down, the agent can still use direct chain reads for canonical state, but opponent/history confidence should degrade.
- Retry later if the error is a timeout or transient prepared-statement issue.

Safety notes:

- Indexer data is enrichment, not the authority for transaction safety.
- Direct SmartCup/Vara program reads remain the canonical source for match status, duplicate predictions, claims, and cutoff checks.

## `football-data.org` Token

Symptoms:

- Fixture/result enrichment is unavailable.
- Provider status says football-data is missing or unauthorized.
- Commands using fixture/result provider return HTTP auth or rate-limit errors.

Checks:

```bash
npm run football-data -- --format summary
npm run setup-check
```

Confirm `.env` has:

```text
FOOTBALL_DATA_API_TOKEN=<your_token>
```

Fixes:

- Use the token from football-data.org.
- Confirm the selected competition is available for your plan.
- Respect rate limits; retry later after rate-limit errors.
- The agent can still run from SmartCup/Vara reads without this token, but fixture/result enrichment may be weaker.

Safety notes:

- Provider tokens belong in `.env` or host env vars, not Git.
- Provider data is advisory and must not override SmartCup chain state.

## Optional Freebet Ledger ID

Symptoms:

- Freebet status says the ledger is missing.
- Freebet balance, grant, surplus, liability, or authorization cannot be checked.
- Freebet-funded planning is unavailable.

Checks:

Confirm `.env` has the ledger id only after the protocol team provides it:

```text
SMARTCUP_FREEBET_LEDGER_ID=<freebet_ledger_program_id>
SMARTCUP_FREEBET_LEDGER_IDL_PATH=artifacts/idl/freebet-ledger.idl
```

Then run:

```bash
npm run freebet -- status --format summary
```

Fixes:

- Leave freebet unset until the real Freebet Ledger program id is confirmed.
- Do not guess or copy a program id from an unrelated environment.
- Confirm the Freebet Ledger authorizes the active BolaoCore program before using freebet planning.

Safety notes:

- If the ledger id is not configured, cash-mode personal predictions can still work.
- Freebet data must not bypass duplicate, cutoff, payload, balance, exposure, or approval guards.

## Claim / Refund Status

Symptoms:

- Claim status returns nothing even when you expected rewards.
- Claim/refund reads fail or time out.
- Render memory usage spikes during claim status.
- Telegram wording around refunds is confusing.

Checks:

```bash
npm run claim -- status --format summary
npm run refund -- status --format summary
npm run setup-check
```

How to read the terms:

- `claim` checks wallet-owned match rewards and final prize opportunities.
- `refund` is the CLI command name for refund-recovery status.
- Telegram presents this area as `Claim Status` so users see one wallet-safety section.

Fixes:

- Confirm the active wallet is the wallet that predicted the match or won the prize.
- Confirm match results are finalized before expecting match reward claims.
- Confirm final-prize status only after the tournament finalization rules allow it.
- If a read times out, retry later or use direct chain setup checks to confirm the program id and IDL path.
- Keep Render worker memory in mind; if claim reads are heavy, test locally first and keep hosted policy in `read_only` until stable.

Safety notes:

- Claim planning is still guarded.
- Live claims require policy permission, explicit approval, eligibility checks, and confirmation/readback where available.
- The bot should never ask for private wallet material to check claims.

## Still Blocked

When you cannot identify the issue:

1. Stay in `read_only`.
2. Run `npm run setup-check` and `npm run telegram-private-smoke -- --format summary`.
3. Check the selected tournament profile and program ids.
4. Check the one-poller rule.
5. Save the friendly error message, but avoid sharing secrets or raw wallet material.
