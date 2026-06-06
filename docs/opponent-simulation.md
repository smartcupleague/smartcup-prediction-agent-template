# SmartCup Prediction Agent Opponent Simulation

Status: schema draft.

Opponent-aware simulation will estimate how other SmartCup participants are likely to predict, then use those sampled predictions to simulate leaderboard movement and top-five final-prize equity.

## Opponent Profile Schema

The TypeScript schema lives in `src/types/index.ts` as `OpponentProfile`.

Top-level fields:

- `wallet`: opponent wallet address.
- `displayName`: SmartCup profile name when available.
- `generatedAt`: profile build timestamp.
- `dataSources`: sources used to derive the profile.
- `archetype`: current behavioral label.
- `archetypeConfidence`: confidence in that label.
- `participation`: likelihood and timing of submitting predictions.
- `scoreTendencies`: exact-score, outcome, draw/home/away, common-score, and high-variance score behavior.
- `biases`: favorite, underdog, contrarian, public-score, and draw bias.
- `stake`: average, median, max, volatility, and trend of stake behavior.
- `rankPressure`: current rank context and whether the opponent is leading, protecting top five, on the bubble, or chasing.
- `sampleQuality`: how much trust to place in the profile.

## Archetypes

Initial archetypes:

- `favorite_chaser`: tends to pick the forecast favorite and common winning scores.
- `public_score`: tends toward common public scores such as 1-0, 2-1, 1-1, 2-0, 0-1, and 0-0.
- `contrarian`: tends away from the crowded visible pool or public-score priors.
- `high_variance`: chooses wider margins or less common scorelines.
- `leader_protect`: high-rank wallet that likely favors safer outcome points.
- `catch_up`: chasing wallet that likely accepts more variance.
- `inactive`: low recent participation probability.
- `unknown`: insufficient data.

## Classifier

The first classifier is deterministic and intentionally conservative:

- `inactive`: no predictions or near-zero participation.
- `leader_protect`: currently first or safely top five.
- `catch_up`: bubble or chasing position.
- `high_variance`: high total-goal or wide-margin score tendency.
- `contrarian`: low common-score/public-score tendency with enough history.
- `public_score`: frequent common-score picks.
- `favorite_chaser`: low draw rate and winner-seeking behavior.
- `unknown`: not enough distinctive evidence.

When sample quality is low, classifier confidence is capped and the profile keeps warning notes.

## Signal Ranges

Unless otherwise noted, bias and rate fields are normalized between `0` and `1`.

- `0`: absent or no evidence.
- `0.5`: neutral or mixed behavior.
- `1`: strong evidence.

Planck fields are stored as strings to avoid integer precision loss.

## Data Sources

Expected sources:

- direct chain state for current points and finalized state
- indexer GraphQL for historical bets and activity records
- SmartCup API for profile display names and leaderboard enrichment
- local memory for agent-observed records
- derived features from visible pool/crowd estimates

## Current Import Command

Use:

```bash
npm run opponents
```

Optional:

```bash
npm run opponents -- --limit 500 --profiles 25
```

The command combines available chain, SmartCup API, and indexer reads. If local indexer GraphQL is unavailable, the command still returns profiles from chain/API sources and marks bet-history-derived fields as low quality with warnings.

## Current Sampler Command

Use:

```bash
npm run sample-opponents -- --match <match_id>
```

Optional:

```bash
npm run sample-opponents -- --match <match_id> --seed smartcup-agent --profiles 50 --topScores 8
```

The sampler uses opponent profiles, archetypes, visible pool/crowd signals, match phase, rank pressure, and the current score forecast to produce reproducible per-opponent participation decisions and score distributions.

## Monte Carlo Simulator

The simulator model lives in `src/models/monte-carlo-leaderboard-model.ts`.

It samples:

- match result from the forecast score matrix
- opponent participation from each profile's participation probability
- opponent score from each profile's sampled score distribution
- operator points for each candidate score
- opponent points for sampled predictions
- projected rank and final-prize equity

It reports:

- `P(top_1)`
- `P(top_3)`
- `P(top_5)`
- expected final-prize equity
- final-prize equity delta
- expected, median, best, and worst rank
- rank volatility
- blocker wallets

The `simulate` command also emits a compact `opponentAware` report shaped for the future decision engine:

- `probabilities.top1`
- `probabilities.top3`
- `probabilities.top5`
- `finalPrize.expectedEquityPlanck`
- `finalPrize.equityDeltaPlanck`
- `rank.expected`
- `rank.median`
- `rank.best`
- `rank.worst`
- `rank.volatility`
- `blockerWallets`

## Simulate Command

Use:

```bash
npm run simulate -- --match <match_id>
```

Optional:

```bash
npm run simulate -- --match <match_id> --iterations 5000 --seed smartcup-agent --objective balanced
```

Additional options:

```bash
--profiles 50 --limit 500 --topScores 8 --candidates 12
```

The `objective` value selects the risk mode. Supported values:

- `conservative`
- `balanced`
- `contrarian`
- `catch_up`
- `protect_lead`
- `final_swing`

The command emits a `risk` report with selected score, weighted utility, component scores, risk-mode weights, and rationale. Risk scoring is computed only from the candidate scores included in the Monte Carlo simulation.

## Next Tasks

1. Emit opponent-aware outputs in the final `DecisionReport`.
2. Persist risk-mode scoring in the memory/audit trail.
