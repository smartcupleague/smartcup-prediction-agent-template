# DecisionReport

`DecisionReport` is the main recommendation artifact for the SmartCup prediction agent.

It is JSON first so it can be stored, hashed, audited, or consumed by a future web/Telegram interface. It also carries a `summary` section so a human can read the same report without parsing every model section.

## Commands

Human-readable summary:

```bash
npm run decide -- --match <match_id> --risk balanced --format summary
```

Pure JSON for files, APIs, hashing, and personal export:

```bash
npm run --silent decide -- --match <match_id> --risk balanced
```

`decide` saves the report to local memory by default. For a preview that does not write to `data/smartcup-agent.memory.json`, add:

```bash
--no-save
```

Useful controls:

```bash
--iterations 5000 --seed smartcup-agent --profiles 50 --limit 500 --topScores 8 --candidates 12
```

Supported risk modes:

- `conservative`
- `balanced`
- `contrarian`
- `catch_up`
- `protect_lead`
- `final_swing`

## Shape

Top-level response:

```json
{
  "decisionReport": {
    "id": "decision-1-balanced-2-1-1780315880191",
    "schemaVersion": "smartpredictor.decision_report.v1",
    "summary": {},
    "selected": {},
    "probabilities": {},
    "economics": {},
    "sourceSnapshots": {},
    "candidates": {},
    "sections": {},
    "sourceWarnings": []
  }
}
```

Human-facing fields:

- `summary.headline`: one-line recommendation.
- `summary.recommendation`: selected scoreline text.
- `summary.confidenceLabel`: `low`, `medium`, or `high`.
- `summary.bullets`: short rationale bullets.
- `selected`: selected score, outcome, penalty winner if needed, utility, and confidence.
- `probabilities`: exact-score and home/draw/away probabilities.
- `economics`: stake, payout EV, points EV, top-five probability, and final-prize equity delta.
- `sourceWarnings`: missing or degraded data sources.

Audit/model fields:

- `modelVersions`: model identifiers used in the report.
- `wallet`: operator account metadata.
- `match`: SmartCup match snapshot.
- `tournament`: tournament and phase context.
- `sourceSnapshots`: chain, pool, tournament-profile, and opponent-sample snapshots used to produce the decision.
- `candidates`: compact ranked candidate lists.
- `sections.forecast`: full score matrix forecast.
- `sections.pool`: SmartCup pool distribution.
- `sections.crowding`: exact-score crowding estimate.
- `sections.payoutEv`: payout EV model output.
- `sections.pointsEv`: points EV model output.
- `sections.simulation`: Monte Carlo leaderboard simulation.
- `sections.opponentAware`: compact opponent-aware report.
- `sections.risk`: risk-mode utility report.

## Reading It

For daily use, read `summary`, `selected`, `probabilities`, `economics`, and `sourceWarnings`.

For debugging, inspect `candidates` first, then drill into `sections`.

For personal exports, keep the full JSON for auditability and render the summary and selected fields for quick reading.
