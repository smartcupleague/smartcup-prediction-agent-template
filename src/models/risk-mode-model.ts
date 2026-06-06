import type {
  CandidatePayoutEvReport,
  CandidatePointsEvReport,
  ExactScoreCrowdingReport,
  FundingSource,
  OpponentAwareOutputReport,
  PoolOutcome,
  RiskMode,
  RiskModeCandidateScore,
  RiskModeEvaluationReport,
  Score,
} from '../types/index.js';

type ComponentName = keyof RiskModeCandidateScore['components'];

const RISK_WEIGHTS: Record<RiskMode, Record<ComponentName, number>> = {
  conservative: {
    forecast: 0.32,
    payout: 0.08,
    points: 0.22,
    leaderboard: 0.08,
    topFive: 0.16,
    contrarian: -0.1,
    rankSafety: 0.22,
    rankUpside: 0.02,
  },
  balanced: {
    forecast: 0.22,
    payout: 0.16,
    points: 0.2,
    leaderboard: 0.16,
    topFive: 0.12,
    contrarian: 0.04,
    rankSafety: 0.06,
    rankUpside: 0.04,
  },
  contrarian: {
    forecast: 0.12,
    payout: 0.2,
    points: 0.12,
    leaderboard: 0.12,
    topFive: 0.06,
    contrarian: 0.28,
    rankSafety: -0.02,
    rankUpside: 0.12,
  },
  catch_up: {
    forecast: 0.1,
    payout: 0.16,
    points: 0.16,
    leaderboard: 0.2,
    topFive: 0.08,
    contrarian: 0.12,
    rankSafety: -0.04,
    rankUpside: 0.22,
  },
  protect_lead: {
    forecast: 0.3,
    payout: 0.06,
    points: 0.22,
    leaderboard: 0.08,
    topFive: 0.18,
    contrarian: -0.12,
    rankSafety: 0.28,
    rankUpside: -0.02,
  },
  final_swing: {
    forecast: 0.08,
    payout: 0.18,
    points: 0.12,
    leaderboard: 0.26,
    topFive: 0.08,
    contrarian: 0.16,
    rankSafety: -0.06,
    rankUpside: 0.26,
  },
};

const FREEBET_WEIGHT_DELTA: Partial<Record<ComponentName, number>> = {
  forecast: -0.04,
  payout: -0.04,
  points: 0.04,
  leaderboard: 0.02,
  topFive: 0.02,
  contrarian: 0.04,
  rankSafety: -0.04,
  rankUpside: 0,
};

export class RiskModeModel {
  evaluate(params: {
    riskMode: RiskMode;
    fundingSource: FundingSource;
    payoutEv: CandidatePayoutEvReport;
    pointsEv: CandidatePointsEvReport;
    crowding: ExactScoreCrowdingReport;
    opponentAware: OpponentAwareOutputReport;
  }): RiskModeEvaluationReport {
    const weights = applyFundingWeights(RISK_WEIGHTS[params.riskMode], params.fundingSource);
    const payoutByScore = new Map(params.payoutEv.candidates.map((candidate) => [scoreKey(candidate.score), candidate]));
    const pointsByScore = new Map(params.pointsEv.candidates.map((candidate) => [scoreKey(candidate.score), candidate]));
    const crowdByScore = new Map(params.crowding.scoreEstimates.map((estimate) => [scoreKey(estimate.score), estimate]));
    const opponentByScore = new Map(params.opponentAware.outputs.map((candidate) => [scoreKey(candidate.score), candidate]));
    const maxPoints = Math.max(...params.pointsEv.candidates.map((candidate) => candidate.expectedWeightedPoints), 0.000001);
    const payoutRois = params.payoutEv.candidates.map((candidate) => candidate.expectedRoi);
    const minRoi = Math.min(...payoutRois);
    const maxRoi = Math.max(...payoutRois);
    const equityDeltas = params.opponentAware.outputs.map((candidate) => Number(candidate.finalPrize.equityDeltaPlanck));
    const minEquity = Math.min(...equityDeltas, 0);
    const maxEquity = Math.max(...equityDeltas, 1);
    const simulatedCandidates = params.pointsEv.candidates.filter((candidate) =>
      opponentByScore.has(scoreKey(candidate.score)),
    );
    const sourceCandidates = simulatedCandidates.length > 0 ? simulatedCandidates : params.pointsEv.candidates;

    const candidates = sourceCandidates.map((pointsCandidate) => {
      const key = scoreKey(pointsCandidate.score);
      const payout = payoutByScore.get(key);
      const crowd = crowdByScore.get(key);
      const opponent = opponentByScore.get(key);
      const components = {
        forecast: pointsCandidate.exactScoreProbability,
        payout: normalizeRange(payout?.expectedRoi ?? minRoi, minRoi, maxRoi),
        points: clamp01(pointsCandidate.expectedWeightedPoints / maxPoints),
        leaderboard: normalizeRange(Number(opponent?.finalPrize.equityDeltaPlanck ?? 0), minEquity, maxEquity),
        topFive: opponent?.probabilities.top5 ?? 0,
        contrarian: 1 - clamp01(crowd?.estimatedShareOfMatchPool ?? 0),
        rankSafety: opponent ? 1 / Math.max(1, opponent.rank.worst) : 0,
        rankUpside: opponent ? 1 / Math.max(1, opponent.rank.best) : 0,
      };
      const utility = weightedUtility(components, weights);
      return {
        score: pointsCandidate.score,
        outcome: pointsCandidate.outcome,
        riskMode: params.riskMode,
        fundingSource: params.fundingSource,
        utility,
        components,
        rationale: rationaleFor(
          params.riskMode,
          params.fundingSource,
          components,
          payout?.expectedRoi ?? null,
          opponent?.blockerWallets.length ?? 0,
        ),
      } satisfies RiskModeCandidateScore;
    });

    candidates.sort((left, right) => right.utility - left.utility);

    return {
      matchId: params.pointsEv.matchId,
      generatedAt: new Date().toISOString(),
      model: 'risk_mode_utility_v1',
      riskMode: params.riskMode,
      fundingSource: params.fundingSource,
      candidates,
      selected: candidates[0] ?? null,
      weights,
    };
  }
}

function weightedUtility(
  components: RiskModeCandidateScore['components'],
  weights: Record<ComponentName, number>,
): number {
  const score = (Object.keys(weights) as ComponentName[]).reduce(
    (sum, key) => sum + components[key] * weights[key],
    0,
  );
  return round(score);
}

function rationaleFor(
  riskMode: RiskMode,
  fundingSource: FundingSource,
  components: RiskModeCandidateScore['components'],
  expectedRoi: number | null,
  blockerCount: number,
): string[] {
  const lines = [`Risk mode ${riskMode} weighted utility=${weightedSummary(components)}.`];
  if (fundingSource === 'freebet') {
    lines.push('Freebet funding reduces user capital downside, so utility leans more toward points, leaderboard pressure, and contrarian room.');
  }
  if (expectedRoi !== null) lines.push(`Payout ROI signal ${round(expectedRoi)}.`);
  if (components.contrarian > 0.75) lines.push('Low estimated exact-score crowding gives contrarian room.');
  if (components.topFive >= 0.75) lines.push('Opponent-aware simulation keeps strong top-five probability.');
  if (components.rankSafety >= 0.5) lines.push('Rank downside appears contained in current simulation.');
  if (components.rankUpside >= 0.5) lines.push('Candidate retains high rank-upside potential.');
  if (blockerCount > 0) lines.push(`${blockerCount} blocker wallet(s) appear in simulation output.`);
  return lines;
}

function weightedSummary(components: RiskModeCandidateScore['components']): string {
  return `forecast:${round(components.forecast)} payout:${round(components.payout)} points:${round(components.points)} leaderboard:${round(components.leaderboard)}`;
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function normalizeRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(max - min) < 1e-12) return 0.5;
  return clamp01((value - min) / (max - min));
}

function applyFundingWeights(
  base: Record<ComponentName, number>,
  fundingSource: FundingSource,
): Record<ComponentName, number> {
  if (fundingSource !== 'freebet') return base;

  const adjusted = { ...base };
  for (const key of Object.keys(FREEBET_WEIGHT_DELTA) as ComponentName[]) {
    adjusted[key] = adjusted[key] + (FREEBET_WEIGHT_DELTA[key] ?? 0);
  }

  const total = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) < 1e-12) return adjusted;

  return (Object.keys(adjusted) as ComponentName[]).reduce(
    (normalized, key) => {
      normalized[key] = round(adjusted[key] / total);
      return normalized;
    },
    {} as Record<ComponentName, number>,
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
