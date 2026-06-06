import type {
  MonteCarloCandidateSummary,
  MonteCarloLeaderboardSimulationReport,
  OpponentAwareCandidateOutput,
  OpponentAwareOutputReport,
} from '../types/index.js';

export class OpponentAwareOutputModel {
  buildReport(
    simulation: MonteCarloLeaderboardSimulationReport,
    objective: string,
  ): OpponentAwareOutputReport {
    const outputs = simulation.candidates.map(toOpponentAwareOutput);
    return {
      matchId: simulation.matchId,
      generatedAt: new Date().toISOString(),
      model: 'opponent_aware_outputs_v1',
      objective,
      seed: simulation.seed,
      iterations: simulation.iterations,
      outputs,
      bestByEquity: bestByEquity(outputs),
      bestByTopFive: bestByTopFive(outputs),
    };
  }
}

function toOpponentAwareOutput(candidate: MonteCarloCandidateSummary): OpponentAwareCandidateOutput {
  return {
    score: candidate.score,
    outcome: candidate.outcome,
    probabilities: {
      top1: candidate.topOneProbability,
      top3: candidate.topThreeProbability,
      top5: candidate.topFiveProbability,
    },
    finalPrize: {
      expectedEquityPlanck: candidate.expectedFinalPrizeEquityPlanck,
      equityDeltaPlanck: candidate.equityDeltaPlanck,
    },
    rank: {
      expected: candidate.expectedRank,
      median: candidate.medianRank,
      best: candidate.bestRank,
      worst: candidate.worstRank,
      volatility: candidate.rankStdDev,
    },
    blockerWallets: candidate.blockerWallets,
  };
}

function bestByEquity(outputs: OpponentAwareCandidateOutput[]): OpponentAwareCandidateOutput | null {
  return (
    [...outputs].sort((left, right) => {
      const diff = BigInt(right.finalPrize.equityDeltaPlanck) - BigInt(left.finalPrize.equityDeltaPlanck);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return right.probabilities.top5 - left.probabilities.top5;
    })[0] ?? null
  );
}

function bestByTopFive(outputs: OpponentAwareCandidateOutput[]): OpponentAwareCandidateOutput | null {
  return (
    [...outputs].sort((left, right) => {
      const diff = right.probabilities.top5 - left.probabilities.top5;
      if (Math.abs(diff) > 1e-12) return diff;
      const equityDiff = BigInt(right.finalPrize.equityDeltaPlanck) - BigInt(left.finalPrize.equityDeltaPlanck);
      if (equityDiff > 0n) return 1;
      if (equityDiff < 0n) return -1;
      return 0;
    })[0] ?? null
  );
}
