import type {
  ConfidenceDegradationLevel,
  ConfidenceDegradationReport,
  ConfidenceSourceFactor,
  CrowdContrarianMapReport,
  ExactScoreCrowdingReport,
  FootballContextRiskReport,
  MarketOddsComparisonReport,
  OpponentAwareOutputReport,
  TimingStrategyReport,
  TournamentPositionStrategyReport,
} from '../types/index.js';

export type ConfidenceDegradationInput = {
  matchId: string;
  originalConfidence: number;
  originalLabel: 'low' | 'medium' | 'high';
  sourceWarnings: string[];
  marketComparison: MarketOddsComparisonReport;
  timingStrategy: TimingStrategyReport;
  crowding: ExactScoreCrowdingReport;
  crowdContrarianMap: CrowdContrarianMapReport;
  footballContextRisk: FootballContextRiskReport;
  tournamentPositionStrategy: TournamentPositionStrategyReport;
  opponentAware: OpponentAwareOutputReport;
  nowMs?: number;
};

export class ConfidenceDegradationModel {
  buildReport(input: ConfidenceDegradationInput): ConfidenceDegradationReport {
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
    const sourceFactors = buildSourceFactors(input);
    const totalPenalty = round(
      Math.min(
        0.42,
        sourceFactors.reduce((sum, factor) => sum + factor.penalty, 0),
      ),
    );
    const adjustedConfidence = round(Math.max(0.05, input.originalConfidence - totalPenalty));
    const adjustedLabel = labelFor(adjustedConfidence);
    const degradationLevel = levelFor(totalPenalty);
    const coverageScore = round(Math.max(0, 1 - totalPenalty / 0.42));

    return {
      matchId: input.matchId,
      generatedAt: new Date(nowMs).toISOString(),
      model: 'confidence_degradation_v1',
      originalConfidence: round(input.originalConfidence),
      adjustedConfidence,
      originalLabel: input.originalLabel,
      adjustedLabel,
      degradationLevel,
      coverageScore,
      totalPenalty,
      sourceFactors,
      summary: summarize(degradationLevel, input.originalLabel, adjustedLabel, coverageScore, sourceFactors),
      suggestedRetryAt: suggestedRetryAt(input, degradationLevel, nowMs),
      warnings: buildWarnings(sourceFactors, degradationLevel),
      assumptions: [
        'This model adjusts displayed decision confidence only; it does not change score probabilities.',
        'Chain/API transport failures carry larger penalties than missing optional odds or news context.',
        'Missing odds and football-context providers reduce confidence because they limit cross-checking, but they do not block a recommendation.',
        'Suggested retry timing is advisory and remains bounded by the existing cutoff buffer guard.',
      ],
    };
  }
}

function buildSourceFactors(input: ConfidenceDegradationInput): ConfidenceSourceFactor[] {
  return [
    chainFactor(input.sourceWarnings),
    indexerFactor(input.sourceWarnings),
    smartCupApiFactor(input.sourceWarnings),
    oddsFactor(input.marketComparison),
    footballContextFactor(input.footballContextRisk),
    crowdFactor(input.crowding, input.crowdContrarianMap),
    leaderboardFactor(input.tournamentPositionStrategy),
    simulationFactor(input.opponentAware),
  ];
}

function chainFactor(warnings: string[]): ConfidenceSourceFactor {
  const matched = warnings.filter((warning) => /querymatch|querystate|rpc|vara-wallet|transport|timeout|sigterm|operation was aborted/i.test(warning));
  if (matched.length === 0) {
    return factor('chain', 'Chain reads', 'healthy', 0, 'Core chain reads did not report transport warnings.');
  }
  const severe = matched.some((warning) => /querystate|querymatch|rpc|transport|timeout|sigterm/i.test(warning));
  return factor(
    'chain',
    'Chain reads',
    severe ? 'degraded' : 'partial',
    severe ? 0.16 : 0.08,
    matched.slice(0, 2).join(' | '),
  );
}

function indexerFactor(warnings: string[]): ConfidenceSourceFactor {
  const matched = warnings.filter((warning) => /indexer|graphql|prepared statement|postgraphile|user stats|bets unavailable/i.test(warning));
  if (matched.length === 0) {
    return factor('indexer', 'Indexer history', 'healthy', 0, 'Indexer reads did not report warnings.');
  }
  return factor(
    'indexer',
    'Indexer history',
    'partial',
    0.08,
    matched.slice(0, 2).join(' | '),
  );
}

function smartCupApiFactor(warnings: string[]): ConfidenceSourceFactor {
  const matched = warnings.filter((warning) =>
    /smartcup api.*(unavailable|failed|timeout|error|aborted)|leaderboard api.*(unavailable|failed|timeout|error|aborted)|profile api.*(unavailable|failed|timeout|error|aborted)/i.test(warning),
  );
  if (matched.length === 0) {
    return factor('smartcup_api', 'SmartCup API', 'healthy', 0, 'SmartCup API/profile reads did not report warnings.');
  }
  return factor('smartcup_api', 'SmartCup API', 'partial', 0.06, matched.slice(0, 2).join(' | '));
}

function oddsFactor(market: MarketOddsComparisonReport): ConfidenceSourceFactor {
  if (!market.providerConfigured) {
    return factor('odds', 'Odds/market cross-check', 'missing', 0.04, 'No odds provider is configured for market comparison.');
  }
  if (market.selected.outcomeComparison === null) {
    return factor('odds', 'Odds/market cross-check', 'partial', 0.03, market.summary);
  }
  return factor('odds', 'Odds/market cross-check', 'healthy', 0, 'Market odds are available for the selected outcome.');
}

function footballContextFactor(context: FootballContextRiskReport): ConfidenceSourceFactor {
  if (!context.providerConfigured) {
    return factor('football_context', 'Lineup/news context', 'missing', 0.05, 'No lineup, injury, suspension, or news provider is configured.');
  }
  if (context.uncertainty === 'high' || context.freshness === 'missing' || context.freshness === 'stale') {
    return factor('football_context', 'Lineup/news context', 'degraded', 0.09, context.summary);
  }
  if (context.uncertainty === 'medium' || context.freshness === 'usable' || context.overallRisk === 'unknown') {
    return factor('football_context', 'Lineup/news context', 'partial', 0.04, context.summary);
  }
  return factor('football_context', 'Lineup/news context', 'healthy', 0, context.summary);
}

function crowdFactor(
  crowding: ExactScoreCrowdingReport,
  crowdMap: CrowdContrarianMapReport,
): ConfidenceSourceFactor {
  if (crowding.totalBets <= 0) {
    return factor('crowd', 'Crowd/pool signal', 'missing', 0.06, 'No visible pool bets are available for crowd estimates.');
  }
  if (crowding.confidence < 0.4 || crowdMap.confidence < 0.4) {
    return factor('crowd', 'Crowd/pool signal', 'partial', 0.04, crowdMap.summary);
  }
  return factor('crowd', 'Crowd/pool signal', 'healthy', 0, crowdMap.summary);
}

function leaderboardFactor(position: TournamentPositionStrategyReport): ConfidenceSourceFactor {
  if (position.rankingSource === 'none') {
    return factor('leaderboard', 'Leaderboard posture', 'missing', 0.07, 'No rank/points rows were available for tournament-position strategy.');
  }
  if (position.rankingSource === 'profile_leaderboard_fallback') {
    return factor(
      'leaderboard',
      'Leaderboard posture',
      'partial',
      0.04,
      'Using SmartCup API/profile leaderboard as provisional unscored fallback because chain user_points is empty.',
    );
  }
  if (position.totalRankedWallets < 3) {
    return factor('leaderboard', 'Leaderboard posture', 'partial', 0.03, 'Leaderboard sample is tiny.');
  }
  return factor('leaderboard', 'Leaderboard posture', 'healthy', 0, 'Chain user_points is available for tournament-position strategy.');
}

function simulationFactor(opponentAware: OpponentAwareOutputReport): ConfidenceSourceFactor {
  if (opponentAware.outputs.length === 0) {
    return factor('simulation', 'Opponent simulation', 'missing', 0.08, 'No opponent-aware candidate outputs were produced.');
  }
  if (opponentAware.iterations < 500) {
    return factor('simulation', 'Opponent simulation', 'partial', 0.03, `Only ${opponentAware.iterations} simulation iteration(s) were used.`);
  }
  return factor('simulation', 'Opponent simulation', 'healthy', 0, `${opponentAware.iterations} simulation iteration(s) produced ${opponentAware.outputs.length} candidate output(s).`);
}

function factor(
  source: ConfidenceSourceFactor['source'],
  label: string,
  status: ConfidenceSourceFactor['status'],
  penalty: number,
  detail: string,
): ConfidenceSourceFactor {
  return {
    source,
    label,
    status,
    penalty: round(penalty),
    detail,
  };
}

function summarize(
  level: ConfidenceDegradationLevel,
  originalLabel: 'low' | 'medium' | 'high',
  adjustedLabel: 'low' | 'medium' | 'high',
  coverageScore: number,
  factors: ConfidenceSourceFactor[],
): string {
  const weak = factors.filter((factor) => factor.status !== 'healthy');
  if (level === 'none') return `Source coverage is healthy; confidence remains ${adjustedLabel}.`;
  const sourceList = weak.map((factor) => factor.label).slice(0, 4).join(', ');
  return `Confidence degraded ${level} from ${originalLabel} to ${adjustedLabel}; coverage score ${coverageScore}. Weak sources: ${sourceList}.`;
}

function suggestedRetryAt(
  input: ConfidenceDegradationInput,
  level: ConfidenceDegradationLevel,
  nowMs: number,
): string | null {
  if (level === 'none' || input.timingStrategy.recommendation === 'blocked_by_cutoff') return null;
  if (input.timingStrategy.nextReviewAt) return input.timingStrategy.nextReviewAt;
  return new Date(nowMs + 60 * 60_000).toISOString();
}

function buildWarnings(
  factors: ConfidenceSourceFactor[],
  level: ConfidenceDegradationLevel,
): string[] {
  if (level === 'none') return [];
  return factors
    .filter((factor) => factor.status !== 'healthy' && factor.penalty > 0)
    .map((factor) => `${factor.label} is ${factor.status}: ${factor.detail}`);
}

function levelFor(totalPenalty: number): ConfidenceDegradationLevel {
  if (totalPenalty >= 0.24) return 'severe';
  if (totalPenalty >= 0.14) return 'moderate';
  if (totalPenalty > 0) return 'minor';
  return 'none';
}

function labelFor(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence < 0.45) return 'low';
  if (confidence < 0.7) return 'medium';
  return 'high';
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
