import type {
  ExactScoreCrowdingReport,
  ExactScoreCrowdEstimate,
  MatchPoolDistributionView,
  PoolOutcome,
  PoolOutcomeDistribution,
  Score,
  U128String,
} from '../types/index.js';

type PublicScorePrior = {
  score: Score;
  weight: number;
};

export type CrowdModelOptions = {
  maxScore?: number;
  topScores?: number;
};

const PUBLIC_SCORE_PRIORS: PublicScorePrior[] = [
  { score: { home: 1, away: 0 }, weight: 10 },
  { score: { home: 2, away: 1 }, weight: 9 },
  { score: { home: 1, away: 1 }, weight: 9 },
  { score: { home: 2, away: 0 }, weight: 8 },
  { score: { home: 0, away: 1 }, weight: 7 },
  { score: { home: 0, away: 0 }, weight: 7 },
  { score: { home: 1, away: 2 }, weight: 6 },
  { score: { home: 3, away: 1 }, weight: 5 },
  { score: { home: 3, away: 0 }, weight: 4 },
  { score: { home: 2, away: 2 }, weight: 4 },
  { score: { home: 0, away: 2 }, weight: 4 },
  { score: { home: 1, away: 3 }, weight: 3 },
  { score: { home: 3, away: 2 }, weight: 3 },
  { score: { home: 2, away: 3 }, weight: 2 },
  { score: { home: 4, away: 1 }, weight: 1.5 },
  { score: { home: 1, away: 4 }, weight: 1.2 },
  { score: { home: 4, away: 0 }, weight: 1 },
  { score: { home: 0, away: 4 }, weight: 1 },
  { score: { home: 3, away: 3 }, weight: 1 },
];

export class CrowdModel {
  private readonly maxScore: number;
  private readonly topScores: number;

  constructor(options: CrowdModelOptions = {}) {
    this.maxScore = options.maxScore ?? 4;
    this.topScores = options.topScores ?? 12;
  }

  estimateExactScoreCrowding(pool: MatchPoolDistributionView): ExactScoreCrowdingReport {
    const priorsByOutcome = normalizePriorsByOutcome(buildPublicScorePriors(this.maxScore));
    const scoreEstimates = priorsByOutcome.flatMap(([outcome, priors]) => {
      const outcomePool = pool.outcomes.find((entry) => entry.outcome === outcome);
      if (!outcomePool) return [];
      return priors.map((prior) => buildEstimate(prior, outcome, outcomePool));
    });

    scoreEstimates.sort((left, right) => right.estimatedShareOfMatchPool - left.estimatedShareOfMatchPool);

    return {
      matchId: pool.matchId,
      generatedAt: new Date().toISOString(),
      model: 'public_score_priors_v1',
      sourcePoolGeneratedAt: pool.generatedAt,
      totalBets: pool.totalBets,
      totalMatchPoolPlanck: pool.totalMatchPoolPlanck,
      outcomeShares: pool.outcomes,
      scoreEstimates,
      topCrowdedScores: scoreEstimates.slice(0, this.topScores),
      assumptions: [
        'Visible SmartCup pool data is available by home/draw/away outcome, not by exact score.',
        'Exact-score crowding is estimated by allocating each visible outcome pool through public-score priors.',
        'Public priors overweight common football scores such as 1-0, 2-1, 1-1, 2-0, 0-1, and 0-0.',
        'This estimate is for EV and crowding strategy only; it is not authoritative chain state.',
      ],
      confidence: crowdConfidence(pool.totalBets),
    };
  }
}

function buildEstimate(
  prior: PublicScorePrior & { normalizedWeight: number },
  outcome: PoolOutcome,
  outcomePool: PoolOutcomeDistribution,
): ExactScoreCrowdEstimate {
  const matchPool = multiplyPlanckByShare(outcomePool.matchPoolPlanck, prior.normalizedWeight);
  return {
    score: prior.score,
    outcome,
    priorShareWithinOutcome: round(prior.normalizedWeight),
    estimatedShareOfBets: round(outcomePool.shareOfBets * prior.normalizedWeight),
    estimatedShareOfMatchPool: round(outcomePool.shareOfMatchPool * prior.normalizedWeight),
    estimatedBets: round(outcomePool.bets * prior.normalizedWeight),
    estimatedMatchPoolPlanck: matchPool,
  };
}

function buildPublicScorePriors(maxScore: number): PublicScorePrior[] {
  const priors = new Map<string, PublicScorePrior>();
  for (let home = 0; home <= maxScore; home += 1) {
    for (let away = 0; away <= maxScore; away += 1) {
      const goalTotal = home + away;
      const margin = Math.abs(home - away);
      const drawBoost = home === away ? 1.15 : 1;
      const commonScoreBoost = goalTotal <= 3 ? 1.25 : 1;
      const weight = Math.max(0.1, Math.exp(-0.72 * goalTotal) * Math.exp(-0.2 * margin) * drawBoost * commonScoreBoost);
      priors.set(scoreKey({ home, away }), { score: { home, away }, weight });
    }
  }

  for (const prior of PUBLIC_SCORE_PRIORS) {
    const key = scoreKey(prior.score);
    const existing = priors.get(key);
    priors.set(key, {
      score: prior.score,
      weight: (existing?.weight ?? 0) + prior.weight,
    });
  }

  return [...priors.values()];
}

function normalizePriorsByOutcome(
  priors: PublicScorePrior[],
): Array<[PoolOutcome, Array<PublicScorePrior & { normalizedWeight: number } >]> {
  const grouped = new Map<PoolOutcome, PublicScorePrior[]>();

  for (const prior of priors) {
    const outcome = scoreOutcome(prior.score);
    grouped.set(outcome, [...(grouped.get(outcome) ?? []), prior]);
  }

  return (['home', 'draw', 'away'] as PoolOutcome[]).map((outcome) => {
    const entries = grouped.get(outcome) ?? [];
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    return [
      outcome,
      entries
        .map((entry) => ({
          ...entry,
          normalizedWeight: totalWeight <= 0 ? 0 : entry.weight / totalWeight,
        }))
        .sort((left, right) => right.normalizedWeight - left.normalizedWeight),
    ];
  });
}

function scoreOutcome(score: Score): PoolOutcome {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function multiplyPlanckByShare(planck: U128String, share: number): U128String {
  if (!/^\d+$/.test(planck)) throw new Error(`Invalid planck value: ${planck}`);
  const scaledShare = BigInt(Math.round(share * 1_000_000));
  return ((BigInt(planck) * scaledShare) / 1_000_000n).toString();
}

function crowdConfidence(totalBets: number): number {
  if (totalBets <= 0) return 0.2;
  if (totalBets < 5) return 0.35;
  if (totalBets < 20) return 0.5;
  if (totalBets < 100) return 0.65;
  return 0.75;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
