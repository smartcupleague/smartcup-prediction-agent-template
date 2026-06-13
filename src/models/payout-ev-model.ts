import type {
  CandidatePayoutEv,
  CandidatePayoutEvReport,
  ExactScoreCrowdingReport,
  FundingSource,
  PoolOutcome,
  Score,
  U128String,
} from '../types/index.js';
import type { ScoreMatrixForecast } from './forecast-model.js';

export type PayoutEvModelOptions = {
  topCandidates?: number;
};

const SCALE = 1_000_000n;

export class PayoutEvModel {
  private readonly topCandidates: number;

  constructor(options: PayoutEvModelOptions = {}) {
    this.topCandidates = options.topCandidates ?? 12;
  }

  computeCandidatePayoutEv(
    forecast: ScoreMatrixForecast,
    crowding: ExactScoreCrowdingReport,
    candidateStakePlanck: U128String,
    fundingSource: FundingSource = 'cash',
  ): CandidatePayoutEvReport {
    const stake = toBigInt(candidateStakePlanck);
    const userCapitalAtRisk = fundingSource === 'freebet' ? 0n : stake;
    const currentTotalMatchPool = toBigInt(crowding.totalMatchPoolPlanck);
    const projectedTotalMatchPool = currentTotalMatchPool + stake;
    const crowdingByScore = new Map(crowding.scoreEstimates.map((estimate) => [scoreKey(estimate.score), estimate]));
    const roiBasis =
      fundingSource === 'freebet' ? 'freebet_payout_over_incentive_amount' : 'cash_profit_over_stake';

    const candidates = forecast.rankedScores.map((cell) => {
      const crowdEstimate = crowdingByScore.get(scoreKey(cell.score));
      const currentScorePool = toBigInt(crowdEstimate?.estimatedMatchPoolPlanck ?? '0');
      const projectedScorePool = currentScorePool + stake;
      const payoutIfExact = projectedScorePool === 0n ? 0n : (projectedTotalMatchPool * stake) / projectedScorePool;
      const profitIfExact = payoutIfExact - stake;
      const expectedPayout = multiplyByProbability(payoutIfExact, cell.probability);
      const expectedProfit = fundingSource === 'freebet' ? expectedPayout : expectedPayout - stake;

      return {
        score: cell.score,
        outcome: cell.outcome as PoolOutcome,
        fundingSource,
        roiBasis,
        scoreProbability: round(cell.probability),
        currentEstimatedScorePoolPlanck: currentScorePool.toString(),
        candidateStakePlanck: stake.toString(),
        userCapitalAtRiskPlanck: userCapitalAtRisk.toString(),
        projectedTotalMatchPoolPlanck: projectedTotalMatchPool.toString(),
        projectedScorePoolPlanck: projectedScorePool.toString(),
        payoutIfExactPlanck: payoutIfExact.toString(),
        profitIfExactPlanck: profitIfExact.toString(),
        expectedPayoutPlanck: expectedPayout.toString(),
        expectedProfitPlanck: expectedProfit.toString(),
        expectedNetValuePlanck: expectedProfit.toString(),
        payoutMultiple: stake === 0n ? 0 : round(Number(payoutIfExact) / Number(stake)),
        expectedRoi: stake === 0n ? 0 : round(Number(expectedProfit) / Number(stake)),
        crowdPenalty: round(crowdEstimate?.estimatedShareOfMatchPool ?? 0),
      } satisfies CandidatePayoutEv;
    });

    candidates.sort((left, right) => {
      const profitDiff = toSignedBigInt(right.expectedProfitPlanck) - toSignedBigInt(left.expectedProfitPlanck);
      if (profitDiff > 0n) return 1;
      if (profitDiff < 0n) return -1;
      return right.scoreProbability - left.scoreProbability;
    });

    return {
      matchId: forecast.matchId,
      generatedAt: new Date().toISOString(),
      model: 'score_probability_x_pool_share_v1',
      fundingSource,
      roiBasis,
      candidateStakePlanck: stake.toString(),
      userCapitalAtRiskPlanck: userCapitalAtRisk.toString(),
      totalMatchPoolPlanck: currentTotalMatchPool.toString(),
      projectedTotalMatchPoolPlanck: projectedTotalMatchPool.toString(),
      candidates,
      topByExpectedProfit: candidates.slice(0, this.topCandidates),
      assumptions: [
        'EV uses the forecast exact-score probability from the current score matrix.',
        'Current exact-score pool share is estimated from visible outcome pools and public-score priors.',
        'Candidate stake is added to both the total match pool and the selected exact-score pool before payout calculation.',
        fundingSource === 'freebet'
          ? 'Freebet EV treats user capital at risk as zero and scores expected net user value from the incentive-backed payout.'
          : 'Cash EV treats the attached stake as user capital at risk and subtracts it from expected payout.',
        'Payout EV excludes final-prize leaderboard value, gas, slippage, and post-submit crowd movement.',
      ],
    };
  }
}

function multiplyByProbability(value: bigint, probability: number): bigint {
  const scaledProbability = BigInt(Math.round(probability * Number(SCALE)));
  return (value * scaledProbability) / SCALE;
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function toBigInt(value: U128String): bigint {
  if (!isNonNegativePlanck(value)) throw new Error(`Invalid planck value: ${value}`);
  return BigInt(value);
}

function isNonNegativePlanck(value: string): boolean {
  return /^\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value);
}

function toSignedBigInt(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid signed planck value: ${value}`);
  return BigInt(value);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
