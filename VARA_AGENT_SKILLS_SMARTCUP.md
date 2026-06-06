# Vara Agent Skills for SmartCup League Prediction Champions

This document defines the agentic skills, investigations, and operating model for a Vara-based SmartCup League prediction agent whose goal is to outperform human players and other agents across any SmartCup League tournament format: the full 2026 FIFA World Cup, a Champions League bracket, a community-created competition, or any invented mini tournament.

It is based on the SmartCup League whitepaper, tournament rules, repo implementation notes, and Vara/Gear architecture. The key strategic insight is simple: SmartCup is not only a forecasting problem. It is a continuous tournament game where the best player optimizes across football probability, crowd behavior, pari-mutuel payout dilution, leaderboard position, phase multipliers, transaction timing, and long-term podium picks.

The World Cup is the main MVP and largest validation moment, but the agent design should be tournament-native rather than World-Cup-specific. SmartCup League will support a variety of tournaments over time, and each one can become a shared arena where humans and agents compete under the same rule-based system.

## Executive Explanation for Vara

SmartCup League is a strong Vara agent use case because it turns agents from passive coding assistants into on-chain competitors that must reason, act, and learn inside a transparent tournament.

Why this fits Vara:

- SmartCup is built around asynchronous program messages, persistent tournament state, and deterministic settlement, which maps naturally to Gear's actor/program model.
- Vara's agentic development initiative already frames Skills as documentation-backed workflows that let agents build, validate, and operate dApps, not just generate code.
- SmartCup adds a consumer-facing arena where those agents can visibly compete with users and with each other.
- The agent has a real on-chain job: evaluate tournament state, make predictions, submit transactions, monitor settlement, claim rewards, and adapt strategy.
- The use case highlights advanced Vara themes: wallet operation, typed Sails/Gear clients, indexer-backed state, possible gasless/signless UX, reputation, and eventually agent-vs-agent competitions.

The shortest solution:

> SmartCup League can become an AI Battle Arena for real sports prediction, where agents use Vara-native wallets and Skills to compete transparently against humans across on-chain tournaments.

The agent is a tournament strategist with persistent memory, chain execution, budget guardrails, leaderboard awareness, and auditable performance.

## Vara Agent Setup According to Current Vara Skills

As of the current public Vara agentic development documentation, Vara Skills are positioned as a portable, documentation-backed skill pack for AI agents. The `gear-foundation/vara-skills` repository currently describes skills for specification, architecture, implementation, Sails IDL/client wiring, React frontend integration, indexers, `gtest`, local smoke validation, Gear message execution, and Vara wallet operations. The public page also lists signless and gasless transaction backend work as an in-progress developer tooling area, and autonomous applications such as AI Battle Arena as a research direction.

Recommended implementation setup:

- `idea-to-spec`: define the SmartCup agent as a first-class product feature with actors, messages, state, events, permissions, and acceptance criteria.
- `gear-architecture-planner` / `sails-architecture`: decide what belongs on-chain, in the agent service, in the indexer, and in the frontend.
- `sails-idl-client`: keep the agent's transaction layer generated from the active BolaoCore IDL instead of hand-maintained payloads.
- `sails-indexer`: project match, prediction, pool, leaderboard, and wallet activity into queryable read models.
- `sails-frontend`: expose agent actions in the React app: predict one match, predict tournament, explain strategy, approve policy, view audit log.
- `gear-message-execution`: reason correctly about asynchronous messages, replies, waitlist behavior, retries, and event confirmation.
- `vara-wallet`: manage the agent wallet, balances, transfers, vouchers, and signed Vara transactions.
- `sails-gtest` / `gtest-tdd-loop`: verify any contract changes for agent-friendly flows before live testing.
- `sails-local-smoke`: validate the end-to-end path after deterministic tests pass.

For the MVP, the agent can run as an off-chain service with a delegated wallet or user-approved session. The app should make the permissions explicit:

- `read_only`: agent can analyze and recommend, but cannot transact.
- `approval_required`: agent prepares predictions, user approves each transaction.
- `tournament_autopilot`: user pre-approves a tournament budget and risk policy; agent submits within those limits.
- `claim_only`: agent can claim rewards but cannot place new predictions.

This makes the agent credible to Vara because it uses the chain as the execution and audit layer, while keeping model inference, sports research, and private strategy off-chain where they belong.

## The Agentic Role in SmartCup League

The agent should act as an autonomous tournament manager, not a simple "pick a score" bot.

Core role:

1. Discover upcoming eligible matches.
2. Gather current football, tournament, market, crowd, and on-chain context.
3. Produce a calibrated score probability distribution.
4. Estimate crowd distribution and payout dilution.
5. Simulate leaderboard and final-prize scenarios.
6. Select the prediction that maximizes the chosen objective.
7. Submit one immutable on-chain prediction per match before cutoff.
8. Monitor results, claims, ranking changes, and opponent behavior.
9. Learn from outcomes and update future strategy.

For any SmartCup tournament, the agent should treat the event as one strategic competition made of multiple prediction commitments. If the contract only exposes `placeBet(match_id, predicted_score, predicted_penalty_winner)`, then each match still requires its own prediction transaction. The important product distinction is that the decisions are not isolated: the agent should optimize the whole tournament portfolio against the leaderboard, prize pool, pool crowding, and its selected risk mode.

The current agent should assume one transaction per match and manage nonce, gas, balance, failed submissions, cutoff timing, and prediction ordering. A future batch helper could improve UX, but it should not replace the agent's strategic tournament planning.

## Tournament-Agnostic Setup

The agent should be configured from a `TournamentProfile`, not from World Cup assumptions.

```json
{
  "tournament_id": "mini-001",
  "name": "SmartCup Mini Tournament",
  "match_count": 10,
  "sport": "football",
  "matches": ["match_1", "match_2"],
  "phase_weights": {
    "default": 1
  },
  "has_championship_pick": false,
  "entry_policy": {
    "min_entry_usd": 3,
    "max_agent_budget_usd": 30
  },
  "objective": "leaderboard_plus_payout",
  "risk_mode": "balanced"
}
```

World Cup profile:

- 104 matches.
- Phase weights from group stage to final.
- Round of 32 championship/podium pick lock-in.
- Long-running memory and ranking strategy over 35-40 days.

Mini tournament profile:

- Usually 10 selected matches.
- May have flat phase weights or custom weights.
- May not have a podium pick.
- Shorter horizon, so each decision carries more importance.
- Stronger need for portfolio diversification because there are fewer chances to recover from errors.

Community tournament profile:

- Community or DAO may choose matches, weights, entry limits, and prize structure.
- Agent must read the tournament config and adapt automatically.
- Agent should explain its strategy in a way normal users can inspect and challenge.

## SmartCup Is Not Polymarket Arbitrage

SmartCup League differs structurally from Polymarket, Kalshi, and other orderbook or AMM prediction venues.

| Dimension | SmartCup League | Polymarket / Prediction Exchanges |
|---|---|---|
| Primary game | Tournament performance plus match rewards | Price discovery and trading |
| Action | One immutable score prediction per wallet per match | Buy/sell/hold/exit positions |
| Liquidity | Participant pool per match | Orderbook or AMM liquidity |
| Edge source | Forecast accuracy plus crowd-positioning plus leaderboard strategy | Mispricing, arbitrage, information latency, liquidity provision |
| Time horizon | Full tournament arc | Event-by-event or portfolio-based |
| Payoff | Pari-mutuel winner split plus final prize ranking | Share payoff at market resolution |
| Social layer | Ranking against other players | Mostly market PnL |
| Strategy after entry | Cannot edit match pick; adapt future picks | Can rebalance or trade out |
| Agent objective | Maximize tournament rank, payout, or blended utility | Maximize risk-adjusted trading return |

The SmartCup agent therefore needs more game-theoretic and tournament-state reasoning than a pure arbitrage agent. It must ask: "What score is likely?" but also "What will everyone else pick?", "How many points do I need?", "Is this match worth taking risk on?", and "Do I need a contrarian position to climb the leaderboard?"

## Why This Is More Than One-off Predictions

A simple integration can call an odds API, pick the favorite, and submit a transaction. That is not enough to win SmartCup.

The agentic value comes from multi-step investigation and autonomous operation:

- It keeps tournament memory across matches.
- It changes strategy based on leaderboard position.
- It weighs exact score probability against crowd dilution.
- It plans a whole tournament portfolio instead of treating each match independently.
- It watches other players and adapts to their revealed behavior.
- It executes on-chain with cutoff, gas, nonce, and wallet guardrails.
- It explains decisions in a user-auditable way.
- It claims rewards and learns from misses after settlement.

The agent's skill is deciding what those inputs mean inside SmartCup's specific game mechanics.

This matters because the agent becomes a repeatable dApp capability:

- analysis agent: recommends predictions;
- execution agent: submits predictions and claims rewards;
- scouting agent: studies the tournament field;
- protocol agent: monitors settlement, oracle health, and finalization;
- community agent: helps DAO/community organizers launch and analyze mini tournaments.

## Champion Agent Skill Stack

### 1. Fixture and Eligibility Skill

The agent must continuously maintain a canonical match calendar.

Capabilities:

- Read registered matches from BolaoCore/indexer/API.
- Resolve match IDs to real-world fixtures and kickoff timestamps.
- Detect phase, point weight, team identities, and knockout rules.
- Track the 10-minute prediction cutoff.
- Exclude cancelled, finalized, locked, or already-predicted matches.
- Prioritize urgent matches by cutoff proximity and model confidence.

Outputs:

- `eligible_matches[]`
- `cutoff_risk`
- `required_transactions`
- `prediction_window_status`

### 2. Football Forecasting Skill

The agent needs a proper match model, not only LLM intuition.

Capabilities:

- Estimate scoreline probabilities, not just win/draw/loss.
- Model expected goals by team strength, opponent strength, venue, rest, travel, injuries, tactical style, weather, and tournament incentives.
- Use external odds as a calibration prior, not as the final answer.
- Include uncertainty ranges and confidence intervals.
- Treat knockout draws and penalty winners separately.
- Update priors after every match in the tournament.

Useful model families:

- Poisson / bivariate Poisson score model.
- Elo or SPI-style team strength model.
- Bayesian updates after tournament performance.
- Market-implied probability calibration from regulated sportsbooks or exchanges.
- News/injury adjustment layer.

Outputs:

- `P(score_home, score_away)`
- `P(home/draw/away)`
- `P(exact_score)`
- `P(penalty_winner | draw, knockout)`
- `model_confidence`

### 3. Pari-Mutuel Pool Intelligence Skill

SmartCup rewards are diluted when many players pick the same winning outcome. The agent must estimate not just what will happen, but what the crowd will do.

Capabilities:

- Read current pool distribution by match when available.
- Estimate hidden exact-score crowding from visible home/draw/away pool data.
- Infer common public picks from favorites, narratives, country fanbases, and social signals.
- Compare expected payout for favorite, moderate, and contrarian scorelines.
- Detect when a likely outcome is too crowded to be worth the payout objective.
- Detect when a less likely score has high expected value because it is underselected.

Formula direction:

```text
expected_match_value =
  P(prediction_wins) *
  expected_share_of_match_pool_if_wins -
  entry_cost
```

The agent must compute this with the active contract split, not with stale docs.

Outputs:

- `crowd_prediction_distribution`
- `expected_winner_count`
- `payout_dilution_risk`
- `expected_match_value`
- `contrarian_opportunity_score`

### 4. Leaderboard Strategy Skill

The whitepaper emphasizes that SmartCup is a continuous game. The agent must optimize tournament rank, not only per-match payout.

Capabilities:

- Read live leaderboard points, exact counts, claims, and wallet performance.
- Estimate how many points are needed for top 5, top 1, or prize tiers.
- Simulate future tournament paths with phase multipliers.
- Decide when to protect position versus take risk.
- Weight late-stage matches more aggressively because finals can swing the leaderboard.
- Avoid overfitting to early group-stage variance.
- Include tie-break prize-splitting scenarios.

Strategic modes:

- `foundation`: group stage, prioritize consistency and data collection.
- `separation`: early knockouts, combine accurate favorites with selective contrarian picks.
- `catch_up`: behind top tier, increase variance in high-weight matches.
- `protect_lead`: ahead, reduce avoidable downside unless crowding makes consensus poor.
- `final_swing`: optimize around final and third-place multipliers plus podium bonus.

Outputs:

- `rank_target`
- `risk_budget`
- `needed_points`
- `phase_weighted_ev`
- `leaderboard_delta_distribution`

### 5. Championship Prediction Skill

The Round of 32 lock-in bonus is its own strategic game.

Capabilities:

- Forecast tournament bracket paths.
- Estimate champion, runner-up, and third-place probabilities.
- Compare safe favorite picks versus differentiated picks.
- Account for current leaderboard position before lock-in.
- Model whether the agent needs uniqueness or maximum probability.

Outputs:

- `champion_pick`
- `runner_up_pick`
- `third_place_pick`
- `bonus_expected_points`
- `differentiation_score`

### 6. Opponent and Meta-Game Scouting Skill

The agent should learn from other players because SmartCup is player-versus-player.

Capabilities:

- Track top wallets' prediction history after picks become visible or inferable.
- Cluster players by style: favorite-heavy, exact-score sharp, contrarian, late-stage risk-taker, national-bias, copycat.
- Estimate which wallets are threats for final prize tiers.
- Detect crowd herding and strategy convergence.
- Compare own score distribution against top-player tendencies.
- Identify exploitable consensus errors.

Outputs:

- `player_style_clusters`
- `top_wallet_risk_profiles`
- `consensus_prediction_map`
- `copycat_detection`
- `leader_strategy_countermove`

### 7. Transaction Execution Skill on Vara

The agent needs reliable chain execution.

Vara context:

- Vara uses Gear Protocol technology, including actor-style programs, persistent program memory, and Wasm smart programs.
- SmartCup interactions happen through asynchronous messages to programs.
- Gear-JS/Sails clients can build typed transactions for frontend or agent execution.

Capabilities:

- Connect to the configured Vara RPC.
- Query active program IDs and metadata.
- Build typed `placeBet` calls.
- Calculate gas and validate balance.
- Sign and submit with the agent wallet.
- Track message status, events, and failures.
- Retry only before cutoff and only when safe.
- Never duplicate a match prediction where one already exists.

Guardrails:

- Maximum stake per match.
- Maximum tournament exposure.
- No prediction within a configured cutoff safety buffer.
- Human approval threshold for unusual stakes or high-risk modes.
- Dry-run/simulation mode before production.

Outputs:

- `tx_plan`
- `gas_estimate`
- `submission_status`
- `event_confirmation`
- `wallet_exposure`

### 8. Settlement, Claim, and Treasury Awareness Skill

The agent should not stop after prediction submission.

Capabilities:

- Monitor oracle finalization.
- Detect claimable match rewards.
- Submit claim transactions before claim deadlines.
- Track unclaimed dust and final prize pool changes.
- Monitor challenge/finalization windows.
- Alert if oracle result conflicts with trusted official data.

Other possible agentic activities:

- Claim rewards automatically.
- Call public finalization functions if anyone can finalize and it helps the ecosystem.
- Watch oracle health and report anomalies.
- Maintain a tournament audit log.
- Generate post-match explanations for users or DAO review.

Outputs:

- `claimable_rewards`
- `claim_deadline`
- `settlement_anomaly`
- `final_prize_pool_estimate`

### 9. Knowledge Expansion and Memory Skill

The agent should improve throughout the tournament.

Capabilities:

- Store every prediction, model probability, crowd estimate, transaction hash, result, points earned, and payout.
- Backtest whether misses came from football model error, crowd model error, or strategic objective mismatch.
- Recalibrate team ratings after every match.
- Build a private dataset of SmartCup-specific crowd behavior.
- Maintain "lessons learned" by phase, team, region, and match type.
- Use post-match evaluation to adjust future risk.

Memory schema examples:

```json
{
  "match_id": "42",
  "phase": "Round of 16",
  "prediction": "2-1",
  "penalty_winner": null,
  "p_exact": 0.087,
  "p_outcome": 0.54,
  "crowd_share_estimate": 0.31,
  "leaderboard_mode": "separation",
  "tx_hash": "0x...",
  "actual_score": "1-1",
  "points": 0,
  "payout": "0",
  "error_label": "football_model"
}
```

## Decision Engine

The agent should optimize a blended objective:

```text
total_utility =
  alpha * expected_match_payout
  + beta * expected_leaderboard_points
  + gamma * expected_final_prize_equity
  + delta * strategic_differentiation_value
  - lambda * downside_risk
```

Recommended default:

- Group stage: higher `beta`, moderate `alpha`, low `delta`.
- Knockouts: increase `gamma` and `delta`.
- Semi-final/final: maximize final-prize equity, not raw match EV.
- If outside top 5 late: accept higher variance.
- If inside top 3 late: avoid unnecessary contrarian picks unless consensus is badly mispriced.

## Example Agent Workflow for One Match

1. Query upcoming matches and identify a match still open for prediction.
2. Pull team and tournament context.
3. Generate scoreline probability matrix.
4. Query current pool and leaderboard state.
5. Estimate crowd distribution and payout dilution.
6. Simulate leaderboard impact under candidate scorelines.
7. Select prediction based on active strategic mode.
8. Validate wallet balance, gas, cutoff, and one-prediction rule.
9. Submit `placeBet`.
10. Store reasoning, inputs, transaction hash, and expected value.
11. Monitor result finalization.
12. Claim reward if available.
13. Update model calibration.

## Example Agent Workflow for a Multi-Match Tournament

If SmartCup launches a tournament with multiple matches:

1. Load the tournament profile: match list, weights, prize rules, cutoff schedule, budget, and risk mode.
2. Build a tournament-level decision plan off-chain.
3. Simulate the predictions as a portfolio, including correlation and leaderboard variance.
4. Rank matches by cutoff urgency, confidence, and strategic importance.
5. Produce match predictions, but score them as one tournament strategy.
6. Submit one transaction per match, unless a future batch contract exists.
7. Confirm each event before marking complete.
8. Stop immediately for a match if a prior prediction exists or the cutoff buffer is breached.
9. Track tournament leaderboard movement after each result.
10. Produce a post-tournament report: points, payout, model calibration, crowd errors, and next-strategy improvements.

The agent should treat this as both a portfolio strategy problem and a transaction scheduling problem. The product should not reduce a multi-match tournament to one bulk API call, because the interesting agentic work is planning across the full tournament and then executing every required on-chain commitment safely.

### User-Facing Agent

- "Predict next match for me" with explanation.
- "Predict all open matches" with risk mode selection.
- "Optimize for leaderboard" versus "optimize for rewards."
- "Conservative / balanced / contrarian" strategy presets.
- "Explain why this score" after model and crowd analysis.
- "Auto-claim my rewards."
- "Show what top players are doing."

### Power-User Agent

- Full tournament autopilot with budget limits.
- Custom risk policy.
- Alert before high-impact matches.
- Bracket and podium prediction simulator.
- Wallet performance diagnostics.

### Protocol/DAO Agent

- Oracle anomaly watcher.
- Settlement and finalization helper.
- Pool and leaderboard analytics reporter.
- Sybil/copycat/herding monitor.
- Tournament health dashboard.

## Minimum Viable Champion Agent

For the first practical version, build these skills first:

1. Fixture eligibility and cutoff tracking.
2. Scoreline probability model.
3. Pool distribution and crowd estimate.
4. Leaderboard-aware strategy mode.
5. Gear-JS transaction executor.
6. Reward claim monitor.
7. Prediction memory and post-match evaluation.

Avoid starting with a generic LLM-only predictor. The LLM should coordinate investigation, explain reasoning, read news, and choose strategy, but numerical prediction quality should come from explicit models and simulations.

## Long-Term Advanced Skills

- Multi-agent debate between football model, crowd model, and leaderboard strategist.
- Adversarial simulations against common player archetypes.
- Social media and regional bias signal extraction.
- Private league strategy.
- Dynamic capital allocation by match importance.
- Cross-platform signal ingestion from sportsbooks, exchanges, and football analytics.
- Automated governance proposal analysis for rule changes.
- Cross-tournament transfer learning.

## Success Metrics

Track the agent on multiple axes:

- Exact score hit rate.
- Correct outcome hit rate.
- Average expected value versus realized payout.
- Points per prediction.
- Phase-weighted points per prediction.
- Final leaderboard rank percentile.
- Top 5 finish probability over time.
- Claim success rate.
- Missed cutoff count.
- Failed transaction count.
- Calibration error by phase.
- Crowd model error.

## Final Design Principle

The champion SmartCup agent should not behave like a bookmaker, a bettor, or a Polymarket arbitrage bot.

It should behave like a tournament strategist:

- Forecast the match.
- Forecast the crowd.
- Forecast the leaderboard.
- Forecast the future bracket.
- Execute reliably on Vara.
- Learn faster than everyone else.

The winning edge comes from combining these layers before every immutable prediction.

## External Vara References

- Vara technology overview: https://wiki.vara.network/docs/gear
- Vara developer page and Gear-JS/agentic development notes: https://vara.network/developers
- Vara agentic development page: https://vara.network/agentic-development
- Vara Skills repository: https://github.com/gear-foundation/vara-skills
