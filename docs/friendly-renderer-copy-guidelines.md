# Friendly Renderer Copy Guidelines

Purpose: keep every Telegram and user-facing SmartCup prediction agent message clear, safe, and useful while preserving raw audit data in saved reports, JSON exports, Markdown exports, and local logs.

These rules apply to every `src/bot/friendly-*-renderer.ts` file and to any Telegram fallback/error message.

## Core Rules

- Write like an operator briefing, not a terminal dump.
- Always state whether the action is read-only, preview-only, blocked, or capable of guarded wallet execution.
- Always include a `Next action` section or a clear final action sentence.
- Explain uncertainty directly: say what is missing, how it affects confidence, and whether the user should refresh before approval.
- Never imply a guaranteed result, payout, rank, or profit.
- Never ask for or accept mnemonics, private keys, seed phrases, browser sessions, wallet JSON, or keystores.

## Forbidden In Default Telegram Output

Do not show:

- Raw command logs such as `npm run`, `tsx`, `node dist/cli.js`, shell output, or stack traces.
- SQLite warnings, Node warnings, dependency warnings, or internal process logs.
- Internal SQL, GraphQL, PostGraphile, Supabase pooler, or indexer error text such as `prepared statement already exists`.
- Raw `vara-wallet` command strings or executable payload arrays.
- Raw planck-only economics.
- Unexplained EV jargon such as `Payout EV`, `ROI`, `equity delta`, `Brier`, or `log-loss` without a plain-English explanation.
- Long JSON blobs, raw model payloads, raw source snapshots, or raw provider responses.

Raw details may remain available in saved `DecisionReport` records, local logs, JSON exports, and Markdown exports.

## Money And Units

- If a VARA amount is shown, include a USD estimate when a VARA/USD price snapshot is available.
- If USD conversion is unavailable, say that explicitly.
- Do not show planck alone in Telegram.
- If planck must be referenced for audit context, pair it with VARA and USD context or move it to JSON/Markdown export.

Good:

```text
Capital at risk: 4.50 VARA (~$3.00 USD at $0.666667/VARA).
```

Acceptable when no price is available:

```text
Capital at risk: 4.50 VARA (USD conversion unavailable).
```

Avoid:

```text
Stake: 4500000000000000 planck
```

## Probability, Points, And EV

- Show home/draw/away probabilities together when discussing match probability.
- Explain exact-score probability separately from match-outcome probability.
- Explain expected points as a model average, not a promised score.
- Explain payout ROI as a cash-pool estimate, not guaranteed profit.

Example:

```text
Expected tournament value: 0.70 points.
This is the model average across exact-score, outcome-only, and wrong-result scenarios.
```

Example:

```text
Cash payout view is negative for this pool right now.
That means the pick is stronger as a leaderboard/points play than as a direct payout play.
```

## Source Failures And Fallbacks

Use source-family language instead of raw provider errors.

Source families:

- Vara chain / BolaoCore reads
- Indexer / historical GraphQL reads
- SmartCup API reads
- Sports fixtures/results provider
- Odds / market provider
- Lineup, injury, suspension, and news context

Every source warning should say:

- What is unavailable.
- What impact it has.
- Whether the action is blocked, degraded, or still usable.
- What the user should do next.

Example:

```text
Indexer / historical GraphQL reads: opponent history, prior bets, crowd signals, and leaderboard simulation may be partial.
Next action: use this as directional only; rerun once the indexer is healthy if competitor strategy matters.
```

Avoid:

```text
Indexer GraphQL error: prepared statement "..." already exists
```

## Live Execution Copy

Any approval/execution message must clearly separate:

- Transaction plan storage.
- Safety gates.
- Live submit attempt.
- Confirmation read-back.
- Next action.

Required safety gate labels:

- Operator policy
- Duplicate prediction
- Prediction payload
- Cutoff buffer
- Balance and exposure
- Freebet readiness
- Claim eligibility

Execution messages must fail closed. If the bot cannot prove a safety condition, say the action stayed blocked.

## Standard Message Shape

Prefer this structure:

```text
Title
Scope/safety line.

Context
- Tournament/match/wallet/report id as needed.

Main takeaway
- The decision or status in plain language.

Important details
- Probabilities, points, money, source quality, or safety gates.

Data quality / uncertainty
- What is missing or degraded.

Next action
- The safest useful thing to do next.
```

Short status messages can collapse sections, but they still need uncertainty and next action when anything is degraded.

## Renderer Review Checklist

Before marking a renderer done, verify:

- No default Telegram output includes raw shell commands or process logs.
- No default Telegram output includes raw SQL/indexer/provider internals.
- No default Telegram output includes planck-only money.
- EV/ROI/points/probability terms have plain-language explanations.
- Source uncertainty is explained with impact.
- The message has a clear next action.
- Personal flows do not ask for third-party wallets, payment details, or service request ids.
- Wallet execution copy says whether it is read-only, preview-only, blocked, submitted, or confirmed.
- Safety copy says the agent never needs secrets and never guarantees results.
