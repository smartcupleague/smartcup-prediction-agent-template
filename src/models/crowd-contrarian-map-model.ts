import type {
  ContrarianScoreOpportunity,
  CrowdContrarianMapReport,
  CrowdOutcomeCluster,
  ExactScoreCrowdEstimate,
  ExactScoreCrowdingReport,
  PoolOutcome,
  PublicScoreCluster,
  Score,
} from '../types/index.js';
import type { ScoreMatrixForecast } from './forecast-model.js';

export type CrowdContrarianMapInput = {
  matchId: string;
  forecast: ScoreMatrixForecast;
  crowding: ExactScoreCrowdingReport;
  selectedScore: Score;
  selectedOutcome: PoolOutcome;
  maxClusters?: number;
  maxOpportunities?: number;
};

export class CrowdContrarianMapModel {
  buildReport(input: CrowdContrarianMapInput): CrowdContrarianMapReport {
    const outcomeClusters = buildOutcomeClusters(input.crowding);
    const likelyPublicScoreClusters = buildPublicScoreClusters(input.crowding, input.maxClusters ?? 8);
    const differentiatedOpportunities = buildDifferentiatedOpportunities(
      input.forecast,
      input.crowding,
      input.maxOpportunities ?? 8,
    );
    const selectedScoreOpportunity =
      differentiatedOpportunities.find((entry) => scoreKey(entry.score) === scoreKey(input.selectedScore)) ??
      buildOpportunityForSelectedScore(input.forecast, input.crowding, input.selectedScore, input.selectedOutcome);
    const warnings = buildWarnings(input.crowding);

    return {
      matchId: input.matchId,
      generatedAt: new Date().toISOString(),
      model: 'crowd_contrarian_map_v1',
      confidence: input.crowding.confidence,
      outcomeClusters,
      likelyPublicScoreClusters,
      differentiatedOpportunities,
      selectedScoreOpportunity,
      summary: summarize(outcomeClusters, likelyPublicScoreClusters, differentiatedOpportunities),
      warnings,
      assumptions: [
        'SmartCup visible pool data exposes home/draw/away crowding, not exact-score crowding.',
        'Exact-score clusters reuse the existing public-score-prior crowding model.',
        'Differentiated opportunities balance model probability against estimated score crowding.',
        'This layer is advisory and does not override payout EV, points EV, or transaction guards.',
      ],
    };
  }
}

function buildOutcomeClusters(crowding: ExactScoreCrowdingReport): CrowdOutcomeCluster[] {
  return crowding.outcomeShares
    .map((outcome) => ({
      outcome: outcome.outcome,
      label: labelOutcome(outcome.outcome),
      shareOfBets: round(outcome.shareOfBets),
      shareOfMatchPool: round(outcome.shareOfMatchPool),
      bets: outcome.bets,
      crowdLevel: levelFromShare(outcome.shareOfMatchPool),
    }))
    .sort((left, right) => right.shareOfMatchPool - left.shareOfMatchPool);
}

function buildPublicScoreClusters(
  crowding: ExactScoreCrowdingReport,
  limit: number,
): PublicScoreCluster[] {
  return crowding.topCrowdedScores.slice(0, limit).map((estimate) => ({
    score: estimate.score,
    outcome: estimate.outcome,
    estimatedShareOfBets: estimate.estimatedShareOfBets,
    estimatedShareOfMatchPool: estimate.estimatedShareOfMatchPool,
    estimatedBets: estimate.estimatedBets,
    clusterLevel: levelFromShare(estimate.estimatedShareOfMatchPool),
    reason: `${formatScore(estimate.score)} is a public-score-prior cluster inside the visible ${estimate.outcome} pool.`,
  }));
}

function buildDifferentiatedOpportunities(
  forecast: ScoreMatrixForecast,
  crowding: ExactScoreCrowdingReport,
  limit: number,
): ContrarianScoreOpportunity[] {
  const crowdByScore = new Map(crowding.scoreEstimates.map((estimate) => [scoreKey(estimate.score), estimate]));
  const maxForecast = Math.max(...forecast.rankedScores.map((cell) => cell.probability), 0.000001);
  const candidates = forecast.rankedScores
    .slice(0, 24)
    .map((cell) => {
      const crowd = crowdByScore.get(scoreKey(cell.score));
      return buildOpportunity(cell.score, cell.outcome as PoolOutcome, cell.probability, forecast, crowd, maxForecast);
    })
    .filter((entry) => entry.forecastProbability >= 0.01)
    .sort((left, right) => right.differentiationScore - left.differentiationScore);
  return candidates.slice(0, limit);
}

function buildOpportunityForSelectedScore(
  forecast: ScoreMatrixForecast,
  crowding: ExactScoreCrowdingReport,
  selectedScore: Score,
  selectedOutcome: PoolOutcome,
): ContrarianScoreOpportunity | null {
  const cell = forecast.rankedScores.find((entry) => scoreKey(entry.score) === scoreKey(selectedScore));
  if (!cell) return null;
  const crowd = crowding.scoreEstimates.find((entry) => scoreKey(entry.score) === scoreKey(selectedScore));
  const maxForecast = Math.max(...forecast.rankedScores.map((entry) => entry.probability), 0.000001);
  return buildOpportunity(selectedScore, selectedOutcome, cell.probability, forecast, crowd, maxForecast);
}

function buildOpportunity(
  score: Score,
  outcome: PoolOutcome,
  forecastProbability: number,
  forecast: ScoreMatrixForecast,
  crowd: ExactScoreCrowdEstimate | undefined,
  maxForecast: number,
): ContrarianScoreOpportunity {
  const estimatedCrowdShare = crowd?.estimatedShareOfMatchPool ?? 0;
  const probabilityStrength = clamp01(forecastProbability / maxForecast);
  const crowdAvoidance = 1 - clamp01(estimatedCrowdShare / 0.25);
  const differentiationScore = round(probabilityStrength * 0.62 + crowdAvoidance * 0.38);
  const outcomeProbability = forecast.outcomeProbabilities[outcome];
  const opportunityLevel =
    differentiationScore >= 0.72 && forecastProbability >= 0.03
      ? 'high'
      : differentiationScore >= 0.52
        ? 'medium'
        : 'low';

  return {
    score,
    outcome,
    forecastProbability: round(forecastProbability),
    outcomeProbability: round(outcomeProbability),
    estimatedCrowdShare: round(estimatedCrowdShare),
    estimatedCrowdBets: round(crowd?.estimatedBets ?? 0),
    differentiationScore,
    opportunityLevel,
    rationale: [
      `${formatScore(score)} keeps model probability ${round(forecastProbability)} while estimated crowd share is ${round(estimatedCrowdShare)}.`,
      `Outcome probability for ${outcome} is ${round(outcomeProbability)}.`,
      opportunityLevel === 'high'
        ? 'This score is a strong differentiated candidate under current crowd estimates.'
        : opportunityLevel === 'medium'
          ? 'This score has some differentiation, but should still be weighed against points and payout EV.'
          : 'This score is not meaningfully differentiated under current crowd estimates.',
    ],
  };
}

function buildWarnings(crowding: ExactScoreCrowdingReport): string[] {
  const warnings: string[] = [];
  if (crowding.totalBets < 10) {
    warnings.push('Visible pool sample is small; crowd clusters may change quickly.');
  }
  if (crowding.confidence < 0.5) {
    warnings.push('Exact-score crowding confidence is low because SmartCup exposes outcome pools, not exact-score pools.');
  }
  return warnings;
}

function summarize(
  outcomes: CrowdOutcomeCluster[],
  clusters: PublicScoreCluster[],
  opportunities: ContrarianScoreOpportunity[],
): string {
  const crowdedOutcome = outcomes[0];
  const topCluster = clusters[0];
  const topOpportunity = opportunities[0];
  if (!crowdedOutcome || !topCluster || !topOpportunity) return 'Crowd contrarian map unavailable.';
  const visibleShare = outcomes.reduce((sum, outcome) => sum + outcome.shareOfMatchPool, 0);
  if (visibleShare <= 0) {
    return `No visible crowd is allocated yet; public-score priors would cluster around ${formatScore(topCluster.score)}, while differentiated opportunity ${formatScore(topOpportunity.score)} has ${topOpportunity.opportunityLevel} contrarian value if the pool stays thin.`;
  }
  return `Visible crowd leans ${crowdedOutcome.label}; likely public cluster is ${formatScore(topCluster.score)}, while differentiated opportunity ${formatScore(topOpportunity.score)} has ${topOpportunity.opportunityLevel} contrarian value.`;
}

function levelFromShare(share: number): 'low' | 'medium' | 'high' {
  if (share >= 0.45) return 'high';
  if (share >= 0.18) return 'medium';
  return 'low';
}

function labelOutcome(outcome: PoolOutcome): string {
  if (outcome === 'home') return 'home win';
  if (outcome === 'draw') return 'draw';
  return 'away win';
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function formatScore(score: Score): string {
  return `${score.home}-${score.away}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
