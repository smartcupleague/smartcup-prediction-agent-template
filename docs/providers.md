# SmartCup Prediction Agent Provider Interfaces

Status: personal-agent provider setup and future-adapter note.

Last reviewed: 2026-06-06. Provider coverage, plans, pricing, and competition availability can change; verify coverage for the active SmartCup tournament before relying on any feed.

The SmartCup prediction agent can use optional external providers for better reasoning, but provider data is advisory. SmartCup chain state remains the authority for match status, existing predictions, points, claims, cutoff, and wallet safety.


## Provider Choice For Personal Agents

Recommended order for a new personal agent:

1. Start with no optional provider and verify direct SmartCup/Vara reads.
2. Add `football-data.org` for baseline fixture/result enrichment. It is already implemented by `FootballDataAdapter`.
3. Add manual odds JSON if you want market comparison before committing to an odds API.
4. Add manual football-context JSON for lineup, injury, suspension, and news-risk notes before committing to a live context provider.
5. After the agent works, evaluate one live odds provider and one football-context provider.

Suggested first live-provider candidates after the baseline:

- Odds only: The Odds API.
- One football provider with several signal types: Sportmonks or API-Football/API-Sports.
- Middle-market soccer data with odds/injury support: SportsDataIO, if coverage includes the target tournament.
- Enterprise-grade official data: Gracenote, Sportradar, or Stats Perform/Opta.

Do not scrape public sites unless their terms explicitly allow automated use. If a useful site has no supported API, treat it as manual scouting context and paste normalized notes into `SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON`.

## Provider Contract

Provider interfaces live in `src/types/index.ts`.

Common contract:

- `ProviderDescriptor`: provider identity, display name, capabilities, base URL, credential requirements, and notes.
- `ProviderHealth`: configured/missing/unavailable status for CLI and future UI checks.
- `ProviderRequestContext`: optional tournament, match, teams, and kickoff context.
- `ProviderBatch<TRecord>`: timestamped normalized records returned by a provider.
- `AgentDataProvider<TRecord, TQuery>`: base interface with `descriptor`, `isConfigured`, `health`, and `fetch`.

Specialized provider interfaces:

- `FixtureResultProvider`: fixtures/results, currently implemented by `FootballDataAdapter`.
- `OddsProvider`: odds snapshots for markets such as match winner, exact score, totals, champion, and podium.
- `NewsProvider`: normalized team/player news with impact direction and reliability fields.
- `InjuryProvider`: normalized player availability, suspensions, expected return, confidence, and source metadata.
- `LineupProvider`: confirmed, probable, projected, or unknown lineup snapshots with freshness and uncertainty labels.
- `FootballContextProvider`: combined lineup, injury, suspension, and news-risk context for a match.

## Normalized Data Rules

- Keep provider IDs and event IDs for traceability.
- Store source timestamps separately from fetch timestamps.
- Normalize probabilities to decimal values where possible.
- Preserve source confidence and reliability separately from model confidence.
- Do not let provider feeds override SmartCup cutoff, status, duplicate-prediction, or wallet safety guards.

## Integration Path

1. Add the provider token to local environment variables.
2. Implement the matching provider interface in `src/adapters`.
3. Normalize provider-specific payloads into the shared record types.
4. Add a CLI smoke command or extend an existing provider command.
5. Store provider snapshots in memory before using them in decisions.
6. Add the provider signal to the strategy model with an explicit weight.

## Current Provider Coverage

Implemented:

- `football-data.org` through `FootballDataAdapter`.
- Capabilities: `fixtures`, `results`.
- CLI: `npm run football-data`.
- Manual odds snapshots through `ManualOddsAdapter`.
- Capabilities: `odds`.
- Env: `SMARTCUP_ODDS_PROVIDER=manual` and `SMARTCUP_ODDS_MANUAL_JSON=<normalized snapshots>`.
- CLI/report surface: `npm run market -- --match <match_id> --format summary`, plus the market section inside `decide` and exported reports.
- Manual football-context snapshots through `ManualFootballContextAdapter`.
- Capabilities: `lineups`, `injuries`, `news`, `football_context`.
- Env: `SMARTCUP_FOOTBALL_CONTEXT_PROVIDER=manual` and `SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON=<normalized context object>`.
- CLI/report surface: `npm run context-risk -- --match <match_id> --format summary`, plus the football-context section inside `decide` and exported reports.

Defined for future adoption:

- news providers
- injury and player availability providers

### Manual Football Context Snapshot Format

The lineup/injury/news layer is intentionally provider-agnostic. Until a live provider is selected, paste normalized match context into `SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON`.

Example:

```json
{
  "lineups": [
    {
      "provider": "manual",
      "providerEventId": "worldcup-2026-mvp-match-4",
      "matchId": "4",
      "team": "United States",
      "status": "probable",
      "observedAt": "2026-06-04T12:00:00.000Z",
      "source": "manual scouting note",
      "confidence": 0.68,
      "freshness": "usable",
      "uncertainty": "medium",
      "players": [
        { "name": "Example Forward", "role": "starter", "position": "FW", "confidence": 0.72 },
        { "name": "Example Midfielder", "role": "absent", "position": "MF", "reason": "injury", "confidence": 0.85 }
      ]
    }
  ],
  "availability": [
    {
      "provider": "manual",
      "playerName": "Example Midfielder",
      "team": "United States",
      "status": "injured",
      "severity": "medium",
      "source": "manual scouting note",
      "observedAt": "2026-06-04T12:00:00.000Z",
      "confidence": 0.85
    }
  ],
  "news": [
    {
      "provider": "manual",
      "headline": "United States may rotate midfield",
      "team": "United States",
      "impact": "negative",
      "reliability": "medium",
      "publishedAt": "2026-06-04T11:30:00.000Z",
      "summary": "Rotation risk increases lineup uncertainty.",
      "confidence": 0.62
    }
  ]
}
```

The report labels each context bundle with data freshness (`fresh`, `usable`, `stale`, `missing`, or `unknown`) and uncertainty (`low`, `medium`, `high`, or `unknown`). These labels influence explanation quality and warnings; they do not override SmartCup chain state or bypass transaction guards.

### Manual Odds Snapshot Format

The market-comparison layer is intentionally provider-agnostic. Until a live odds provider is selected, paste normalized bookmaker snapshots into `SMARTCUP_ODDS_MANUAL_JSON`.

Example:

```json
[
  {
    "provider": "manual",
    "providerEventId": "worldcup-2026-mvp-match-4",
    "matchId": "4",
    "market": "match_winner",
    "observedAt": "2026-06-04T12:00:00.000Z",
    "selections": [
      { "label": "Home", "outcome": "home", "priceDecimal": 1.95, "bookmaker": "manual" },
      { "label": "Draw", "outcome": "draw", "priceDecimal": 3.4, "bookmaker": "manual" },
      { "label": "Away", "outcome": "away", "priceDecimal": 4.1, "bookmaker": "manual" }
    ]
  }
]
```

The report compares the agent's model probability with bookmaker implied probability. For match-winner markets, it also normalizes away bookmaker overround before computing edge.

## Candidate Sports Data Providers

These providers are candidates for future adapters. They are not active dependencies until a token, contract, adapter, and smoke command are added. The notes below are meant to help a personal-agent owner choose an integration path, not to endorse a provider.

| Provider | Candidate Interface | Best Use | Integration Notes |
| --- | --- | --- | --- |
| [Gracenote Sports Data](https://gracenote.com/products/sports-data/) | `FixtureResultProvider`, `NewsProvider`, future stats interfaces | Enterprise sports metadata, schedules, scores, statistics, team/player information | Strong official-data candidate for a mature SmartCup data layer. Likely enterprise contract/licensing based. |
| [Sportradar Sports Data API](https://sportradar.com/media-tech/data-content/sports-data-api/) | `FixtureResultProvider`, `OddsProvider`, `InjuryProvider`, future stats interfaces | Enterprise live sports data, soccer APIs, statistics, odds, lineups | Premium long-term provider. Good for scale, but enterprise licensing and integration process may be heavier. |
| [Stats Perform / Opta](https://www.statsperform.com/) | Future advanced football stats interface, `FixtureResultProvider` | Premium Opta football event data, advanced stats, team/player analytics | High-value model-quality provider. Likely enterprise licensing. |
| [Genius Sports](https://www.geniussports.com/engage/official-sports-data-api/) | `FixtureResultProvider`, future official-data interfaces | Official league data, live feeds, integrity-oriented data | Best considered when official rights/provenance become important to SmartCup. |
| [Sportmonks Football API](https://www.sportmonks.com/football-api/) | `FixtureResultProvider`, `OddsProvider`, `NewsProvider`, `InjuryProvider`, `LineupProvider` | Developer-friendly football fixtures, stats, odds, expected lineups, injuries/suspensions, and news add-ons | Good personal-agent upgrade candidate because one provider can cover several optional signal types. Validate World Cup coverage, latency, and plan limits before relying on it. |
| [API-Football / API-Sports](https://www.api-football.com/) | `FixtureResultProvider`, `OddsProvider`, `InjuryProvider`, `LineupProvider` | Fixtures, standings, live scores, events, lineups, players, statistics, predictions, bookmakers, and odds | Practical developer API. Validate World Cup coverage, injury quality, and odds freshness before relying on it. |
| [SportsDataIO Soccer API](https://sportsdata.io/soccer-api) | `FixtureResultProvider`, `OddsProvider`, `InjuryProvider`, future projections interface | Soccer fixtures, game odds, injuries, projections, and broad league/cup coverage | Good middle-market option if coverage includes the active SmartCup tournament. Confirm trial limitations before building against it. |
| [Enetpulse Football Data](https://enetpulse.com/football-data/) | `FixtureResultProvider`, future stats interfaces | Football live scores, fixtures, statistics, XML/API/GraphQL-style feeds | Useful if SmartCup wants established live-score and stats feeds with flexible delivery. |
| [The Odds API](https://the-odds-api.com/sports-odds-data/) | `OddsProvider` | Odds aggregation for upcoming/live games by sport, region, and bookmaker | Best for odds intelligence only. Should complement, not replace, fixture/result data. Good first real odds adapter candidate. |
| [OddsPapi](https://docs.oddspapi.io/) | `OddsProvider`, possible `InjuryProvider` | Realtime odds plus lineups/injuries/stats in some plans | Interesting betting-market source. Needs coverage and schema validation. |
| [AnySport API](https://docs.anysport.io/) | `FixtureResultProvider`, `OddsProvider`, `LineupProvider` | Football live scores, fixtures, standings, odds, lineups, team/player data, REST and WebSocket delivery | Potential lower-friction developer option. Evaluate reliability, coverage, and terms before production use. |
| [Native Stats](https://native-stats.org/competition/WC/) | Manual scouting reference, not first API adapter | Public World Cup stats view built on top of football-data.org | Useful visual reference for humans. Prefer the underlying football-data.org API for automated use, and avoid scraping unless terms allow it. |

## Suggested Adoption Order

1. Keep `football-data.org` as the baseline fixture/result source.
2. Add one odds source first, likely `The Odds API` or `Sportmonks`.
3. Add one football-context source for injuries, suspensions, expected lineups, and news, likely `Sportmonks`, `API-Football`, or `SportsDataIO`.
4. Evaluate `Gracenote`, `Sportradar`, and `Stats Perform / Opta` only once the personal-agent ecosystem has enough usage to justify enterprise licensing and integration work.

## Provider Safety Checklist

Before enabling a live provider in decisions:

- Confirm the provider legally covers the active tournament and intended use.
- Confirm response freshness, rate limits, plan limits, and outage behavior.
- Normalize provider event/team IDs to SmartCup tournament match IDs before using the data.
- Store source timestamp and fetch timestamp separately.
- Label missing, stale, or uncertain provider data in reports.
- Never let provider data bypass SmartCup chain guards, duplicate checks, cutoff checks, wallet balance checks, or approval policy.
