# Local Storage

The SmartCup prediction agent uses SQLite as the durable local memory store and keeps the previous JSON memory file as a compatibility mirror.

## Files

- SQLite database: `data/smartcup-agent.memory.sqlite`
- JSON mirror: `data/smartcup-agent.memory.json`

Both SQLite and database sidecar files are ignored by git.

The SQLite path can be changed with:

```bash
SMARTPREDICTOR_SQLITE_PATH=data/smartcup-agent.memory.sqlite
```

## Schema

Migrations are embedded in `src/memory/sqlite-store.ts` and tracked in `schema_migrations`.

Current tables:

- `schema_migrations`: applied migration versions.
- `predictions`: one row per stored prediction, with queryable metadata plus full JSON payload.
- `decisions`: one row per saved `DecisionReport`, with queryable metadata plus full JSON payload.
- `transaction_plans`: one row per prepared transaction plan, with queryable metadata plus full JSON payload.
- `transaction_results`: one row per transaction result or blocked submission event, with queryable metadata plus full JSON payload.
- `outcome_evaluations`: one row per decision evaluation, with result, payout, points, classification, and full JSON payload.
- `parser_telemetry`: one row per natural-language parse event, with hashed raw text, parsed intent, confidence, action, and safety outcome.
- `telegram_preferences`: one row per Telegram subject/tournament/role, with default risk, objective, and strategy posture.
- `runtime_policies`: one row per persisted runtime policy, with current mode and startup fallback metadata.
- `telegram_prediction_alerts`: one row per sent prediction-window reminder, with a uniqueness guard so restarts do not resend the same alert.

`decisions` stores these queryable fields:

- `id`
- `generated_at`
- `match_id`
- `risk_mode`
- selected score and outcome
- utility
- confidence
- model versions JSON
- source warnings JSON
- full `DecisionReport` JSON

`transaction_plans` stores these queryable fields:

- `id`
- `created_at`
- `updated_at`
- `decision_id`
- `kind`
- `status`
- `wallet`
- `program_id`
- `method`
- `value_planck`
- `risk_mode`
- `requires_approval`
- full transaction plan JSON

`transaction_results` stores these queryable fields:

- `id`
- `plan_id`
- `created_at`
- `updated_at`
- `status`
- `tx_hash`
- `message_id`
- `block_hash`
- `block_number`
- `error`
- full transaction result JSON

`outcome_evaluations` stores these queryable fields:

- `id`
- `decision_id`
- `match_id`
- `evaluated_at`
- `status`
- `actual_result_status`
- `awarded_weighted_points`
- `payout_status`
- `amount_claimable_planck`
- `error_classification`
- full outcome evaluation JSON

## Import And Dual-Write

When `MemoryStore` starts, it:

1. Reads `data/smartcup-agent.memory.json`.
2. Runs SQLite migrations.
3. Imports existing JSON predictions, reports, transaction plans, transaction results, outcome evaluations, parser telemetry, and Telegram preferences into SQLite with upsert semantics.
4. Reads active memory from SQLite.

When a prediction, decision, transaction plan, transaction result, outcome evaluation, parser telemetry entry, Telegram preference, runtime policy, or Telegram prediction alert is saved, the store writes to both:

- SQLite, as the durable queryable store.
- JSON, as the compatibility mirror.

Telegram preferences are stored per Telegram subject, tournament id, and role. They persist default risk mode, simulation objective, and strategy posture so slash commands, natural-language controls, and menu buttons can share the same state. Runtime policy is also persisted locally so hosted workers can reload Telegram policy changes when the same SQLite state is available. Prediction alerts are persisted so each chat/tournament/match/lead-time reminder is sent once.

## Operational Notes

Node 22 exposes SQLite through `node:sqlite`, which currently emits an experimental warning on stderr. This does not corrupt JSON stdout, but terminal users may see the warning until Node marks the API stable or we replace it with a packaged SQLite driver.

Useful inspection commands:

```bash
sqlite3 data/smartcup-agent.memory.sqlite ".tables"
sqlite3 data/smartcup-agent.memory.sqlite "select risk_mode, count(*) from decisions group by risk_mode;"
sqlite3 data/smartcup-agent.memory.sqlite "select role, tournament_id, default_risk_mode, simulation_objective, strategy_posture from telegram_preferences;"
npm run report
npm run report -- --full true
```
