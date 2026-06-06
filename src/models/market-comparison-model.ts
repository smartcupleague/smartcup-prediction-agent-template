import type {
  MarketComparisonProbability,
  MarketOddsComparisonReport,
  NormalizedOddsSelection,
  NormalizedOddsSnapshot,
  PoolOutcome,
  Score,
} from '../types/index.js';

export type MarketComparisonInput = {
  matchId: string;
  selectedScore: Score;
  selectedOutcome: PoolOutcome;
  probabilities: {
    exactScore: number;
    home: number;
    draw: number;
    away: number;
  };
  provider: string;
  providerConfigured: boolean;
  snapshots: NormalizedOddsSnapshot[];
  warnings?: string[];
};

export class MarketComparisonModel {
  buildReport(input: MarketComparisonInput): MarketOddsComparisonReport {
    const matchWinner = latestSnapshot(input.snapshots, 'match_winner');
    const exactScore = latestSnapshot(input.snapshots, 'exact_score');
    const exactScoreSelection = exactScore ? findExactScoreSelection(exactScore, input.selectedScore) : null;
    const matchWinnerComparison = matchWinner
      ? buildMatchWinnerComparison(matchWinner, input.probabilities)
      : null;
    const exactScoreComparison = exactScore
      ? compareProbability(input.probabilities.exactScore, exactScoreSelection, null)
      : null;
    const outcomeComparison = matchWinnerComparison?.[input.selectedOutcome] ?? null;
    const warnings = [...(input.warnings ?? [])];

    if (!input.providerConfigured && !warnings.some((warning) => warning.toLowerCase().includes('not configured'))) {
      warnings.push('Odds provider is not configured; market comparison is unavailable.');
    }
    if (input.providerConfigured && input.snapshots.length === 0) {
      warnings.push('No odds snapshots matched this match; market comparison is unavailable.');
    }
    if (matchWinner && !outcomeComparison) warnings.push('Match-winner odds snapshot did not include the selected outcome.');
    if (exactScore && !exactScoreComparison) warnings.push('Exact-score odds snapshot did not include the selected score.');

    return {
      matchId: input.matchId,
      generatedAt: new Date().toISOString(),
      model: 'market_odds_comparison_v1',
      provider: input.provider,
      providerConfigured: input.providerConfigured,
      observedAt: latestObservedAt(input.snapshots),
      markets: {
        matchWinner: matchWinner && matchWinnerComparison
          ? {
              overround: marketOverround(matchWinner),
              home: matchWinnerComparison.home,
              draw: matchWinnerComparison.draw,
              away: matchWinnerComparison.away,
            }
          : null,
        exactScore: exactScoreComparison,
      },
      selected: {
        outcome: input.selectedOutcome,
        score: input.selectedScore,
        outcomeComparison,
        exactScoreComparison,
      },
      summary: summarize(outcomeComparison, exactScoreComparison, input.providerConfigured),
      warnings,
      snapshots: input.snapshots,
    };
  }
}

function buildMatchWinnerComparison(
  snapshot: NormalizedOddsSnapshot,
  probabilities: MarketComparisonInput['probabilities'],
): Record<PoolOutcome, MarketComparisonProbability> {
  return {
    home: compareProbability(probabilities.home, findOutcomeSelection(snapshot, 'home'), normalizedSelectionProbability(snapshot, findOutcomeSelection(snapshot, 'home'))),
    draw: compareProbability(probabilities.draw, findOutcomeSelection(snapshot, 'draw'), normalizedSelectionProbability(snapshot, findOutcomeSelection(snapshot, 'draw'))),
    away: compareProbability(probabilities.away, findOutcomeSelection(snapshot, 'away'), normalizedSelectionProbability(snapshot, findOutcomeSelection(snapshot, 'away'))),
  };
}

function compareProbability(
  agentProbability: number,
  selection: NormalizedOddsSelection | null,
  normalizedMarketProbability: number | null,
): MarketComparisonProbability {
  const marketImpliedProbability = selection?.impliedProbability ?? impliedFromDecimal(selection?.priceDecimal ?? null);
  const marketProbability = normalizedMarketProbability ?? marketImpliedProbability;
  const edge = marketProbability === null ? null : round(agentProbability - marketProbability);
  return {
    agentProbability: round(agentProbability),
    marketImpliedProbability: marketImpliedProbability === null ? null : round(marketImpliedProbability),
    marketNormalizedProbability: normalizedMarketProbability === null ? null : round(normalizedMarketProbability),
    edge,
    edgeDirection: edge === null ? 'unavailable' : edge > 0.015 ? 'positive' : edge < -0.015 ? 'negative' : 'neutral',
    bookmaker: selection?.bookmaker ?? null,
    priceDecimal: selection?.priceDecimal ?? null,
  };
}

function latestSnapshot(
  snapshots: NormalizedOddsSnapshot[],
  market: NormalizedOddsSnapshot['market'],
): NormalizedOddsSnapshot | null {
  return snapshots
    .filter((snapshot) => snapshot.market === market)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function findOutcomeSelection(snapshot: NormalizedOddsSnapshot, outcome: PoolOutcome): NormalizedOddsSelection | null {
  return snapshot.selections.find((selection) => selection.outcome === outcome) ?? null;
}

function findExactScoreSelection(snapshot: NormalizedOddsSnapshot, score: Score): NormalizedOddsSelection | null {
  return (
    snapshot.selections.find(
      (selection) => selection.outcome === 'exact_score' && selection.score?.home === score.home && selection.score.away === score.away,
    ) ?? null
  );
}

function normalizedSelectionProbability(
  snapshot: NormalizedOddsSnapshot,
  selection: NormalizedOddsSelection | null,
): number | null {
  if (!selection) return null;
  const implied = selection.impliedProbability ?? impliedFromDecimal(selection.priceDecimal);
  if (implied === null) return null;
  const total = snapshot.selections.reduce((sum, entry) => sum + (entry.impliedProbability ?? impliedFromDecimal(entry.priceDecimal) ?? 0), 0);
  return total > 0 ? implied / total : null;
}

function marketOverround(snapshot: NormalizedOddsSnapshot): number | null {
  const total = snapshot.selections.reduce((sum, selection) => sum + (selection.impliedProbability ?? impliedFromDecimal(selection.priceDecimal) ?? 0), 0);
  return total > 0 ? round(total) : null;
}

function impliedFromDecimal(priceDecimal: number | null): number | null {
  return priceDecimal && priceDecimal > 0 ? 1 / priceDecimal : null;
}

function latestObservedAt(snapshots: NormalizedOddsSnapshot[]): string | null {
  return snapshots
    .map((snapshot) => snapshot.observedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function summarize(
  outcomeComparison: MarketComparisonProbability | null,
  exactScoreComparison: MarketComparisonProbability | null,
  providerConfigured: boolean,
): string {
  if (!providerConfigured) return 'Market comparison unavailable because no odds provider is configured.';
  if (!outcomeComparison && !exactScoreComparison) return 'Market comparison unavailable for the selected prediction.';
  if (outcomeComparison?.edgeDirection === 'positive') {
    return `Agent outcome probability is above normalized market probability by ${formatEdge(outcomeComparison.edge)}.`;
  }
  if (outcomeComparison?.edgeDirection === 'negative') {
    return `Agent outcome probability is below normalized market probability by ${formatEdge(outcomeComparison.edge)}.`;
  }
  return 'Agent outcome probability is broadly aligned with the market.';
}

function formatEdge(edge: number | null): string {
  return edge === null ? 'n/a' : `${round(edge * 100)} percentage points`;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
