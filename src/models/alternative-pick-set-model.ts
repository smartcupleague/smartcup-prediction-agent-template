import type {
  AlternativePickKind,
  AlternativePickRecommendation,
  AlternativePickSetReport,
  CandidatePayoutEvReport,
  CandidatePointsEvReport,
  OpponentAwareOutputReport,
  PoolOutcome,
  RiskModeCandidateScore,
  RiskModeEvaluationReport,
  Score,
} from '../types/index.js';

type CandidateContext = {
  candidate: RiskModeCandidateScore;
  exactScoreProbability: number;
  expectedWeightedPoints: number | null;
  expectedRoi: number | null;
  topFiveProbability: number | null;
  finalPrizeEquityDeltaPlanck: string | null;
};

export class AlternativePickSetModel {
  buildReport(input: {
    matchId: string;
    risk: RiskModeEvaluationReport;
    payoutEv: CandidatePayoutEvReport;
    pointsEv: CandidatePointsEvReport;
    opponentAware: OpponentAwareOutputReport;
  }): AlternativePickSetReport {
    const contexts = buildCandidateContexts(input);
    const picks = buildDistinctPicks(contexts);
    const warnings = buildWarnings(picks, contexts);

    return {
      matchId: input.matchId,
      generatedAt: new Date().toISOString(),
      model: 'alternative_pick_set_v1',
      picks,
      summary: summarize(picks),
      warnings,
      assumptions: [
        'Alternative picks reuse the same candidate pool as the main DecisionReport.',
        'Safest emphasizes forecast probability, points, top-five probability, and rank safety.',
        'Contrarian emphasizes low estimated crowding while keeping minimum forecast quality.',
        'Leaderboard-upside emphasizes rank upside, final-prize equity delta, and phase-weighted points.',
        'These are advisory alternatives; execution still requires the existing approval flow and guards.',
      ],
    };
  }
}

function buildCandidateContexts(input: {
  risk: RiskModeEvaluationReport;
  payoutEv: CandidatePayoutEvReport;
  pointsEv: CandidatePointsEvReport;
  opponentAware: OpponentAwareOutputReport;
}): CandidateContext[] {
  const payoutByScore = new Map(input.payoutEv.candidates.map((candidate) => [scoreKey(candidate.score), candidate]));
  const pointsByScore = new Map(input.pointsEv.candidates.map((candidate) => [scoreKey(candidate.score), candidate]));
  const opponentByScore = new Map(input.opponentAware.outputs.map((candidate) => [scoreKey(candidate.score), candidate]));

  return input.risk.candidates.map((candidate) => {
    const key = scoreKey(candidate.score);
    const points = pointsByScore.get(key);
    const payout = payoutByScore.get(key);
    const opponent = opponentByScore.get(key);
    return {
      candidate,
      exactScoreProbability: points?.exactScoreProbability ?? candidate.components.forecast,
      expectedWeightedPoints: points?.expectedWeightedPoints ?? null,
      expectedRoi: payout?.expectedRoi ?? null,
      topFiveProbability: opponent?.probabilities.top5 ?? null,
      finalPrizeEquityDeltaPlanck: opponent?.finalPrize.equityDeltaPlanck ?? null,
    };
  });
}

function buildDistinctPicks(contexts: CandidateContext[]): AlternativePickRecommendation[] {
  const usedScores = new Set<string>();
  const balanced = buildPick('balanced', contexts, (context) => context.candidate.utility, usedScores);
  if (balanced) usedScores.add(scoreKey(balanced.score));
  const safest = buildPick('safest', contexts, scoreSafest, usedScores);
  if (safest) usedScores.add(scoreKey(safest.score));
  const contrarian = buildPick('contrarian', contexts, scoreContrarian, usedScores);
  if (contrarian) usedScores.add(scoreKey(contrarian.score));
  const leaderboardUpside = buildPick('leaderboard_upside', contexts, scoreLeaderboardUpside, usedScores);

  return [safest, balanced, contrarian, leaderboardUpside].filter(
    (pick): pick is AlternativePickRecommendation => pick !== null,
  );
}

function buildPick(
  kind: AlternativePickKind,
  contexts: CandidateContext[],
  score: (context: CandidateContext) => number,
  excludedScores: Set<string>,
): AlternativePickRecommendation | null {
  const ranked = contexts
    .filter((context) => isEligibleForKind(kind, context))
    .map((context) => ({ context, score: score(context) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (Math.abs(scoreDiff) > 1e-12) return scoreDiff;
      return right.context.candidate.utility - left.context.candidate.utility;
    });
  const selected =
    ranked.find((entry) => !excludedScores.has(scoreKey(entry.context.candidate.score)))?.context ??
    ranked[0]?.context ??
    contexts[0] ??
    null;
  if (!selected) return null;

  return {
    kind,
    label: labelForKind(kind),
    score: selected.candidate.score,
    outcome: selected.candidate.outcome,
    sourceRiskMode: selected.candidate.riskMode,
    utility: selected.candidate.utility,
    confidence: confidenceFor(kind, selected),
    exactScoreProbability: round(selected.exactScoreProbability),
    expectedWeightedPoints: selected.expectedWeightedPoints === null ? null : round(selected.expectedWeightedPoints),
    expectedRoi: selected.expectedRoi === null ? null : round(selected.expectedRoi),
    topFiveProbability: selected.topFiveProbability === null ? null : round(selected.topFiveProbability),
    finalPrizeEquityDeltaPlanck: selected.finalPrizeEquityDeltaPlanck,
    components: selected.candidate.components,
    rationale: rationaleFor(kind, selected),
  };
}

function isEligibleForKind(kind: AlternativePickKind, context: CandidateContext): boolean {
  if (kind === 'contrarian') return context.exactScoreProbability >= 0.01;
  if (kind === 'leaderboard_upside') return context.expectedWeightedPoints === null || context.expectedWeightedPoints > 0;
  return true;
}

function scoreSafest(context: CandidateContext): number {
  const components = context.candidate.components;
  return (
    components.forecast * 0.32 +
    components.points * 0.2 +
    components.topFive * 0.18 +
    components.rankSafety * 0.24 +
    components.leaderboard * 0.08 -
    components.contrarian * 0.04
  );
}

function scoreContrarian(context: CandidateContext): number {
  const components = context.candidate.components;
  return (
    components.contrarian * 0.42 +
    components.forecast * 0.2 +
    components.payout * 0.14 +
    components.points * 0.1 +
    components.rankUpside * 0.1 +
    context.candidate.utility * 0.04
  );
}

function scoreLeaderboardUpside(context: CandidateContext): number {
  const components = context.candidate.components;
  return (
    components.rankUpside * 0.32 +
    components.leaderboard * 0.28 +
    components.points * 0.16 +
    components.contrarian * 0.12 +
    components.topFive * 0.08 +
    components.forecast * 0.04
  );
}

function confidenceFor(kind: AlternativePickKind, context: CandidateContext): AlternativePickRecommendation['confidence'] {
  const components = context.candidate.components;
  const value =
    kind === 'safest'
      ? components.forecast * 0.38 + components.rankSafety * 0.3 + components.topFive * 0.2 + components.points * 0.12
      : kind === 'contrarian'
        ? components.contrarian * 0.42 + components.forecast * 0.3 + components.points * 0.16 + components.rankUpside * 0.12
        : kind === 'leaderboard_upside'
          ? components.rankUpside * 0.34 + components.leaderboard * 0.3 + components.points * 0.18 + components.topFive * 0.18
          : context.candidate.utility;
  if (value >= 0.68) return 'high';
  if (value >= 0.42) return 'medium';
  return 'low';
}

function rationaleFor(kind: AlternativePickKind, context: CandidateContext): string[] {
  const score = formatScore(context.candidate.score);
  const components = context.candidate.components;
  if (kind === 'safest') {
    return [
      `${score} is the safety pick because it balances forecast strength ${round(components.forecast)}, points ${round(components.points)}, top-five probability ${round(components.topFive)}, and rank safety ${round(components.rankSafety)}.`,
      'Use this when protecting position matters more than differentiation.',
    ];
  }
  if (kind === 'contrarian') {
    return [
      `${score} is the contrarian pick because exact-score crowd avoidance is ${round(components.contrarian)} while forecast probability remains ${round(context.exactScoreProbability)}.`,
      'Use this when the visible pool looks crowded around public-score clusters.',
    ];
  }
  if (kind === 'leaderboard_upside') {
    return [
      `${score} is the leaderboard-upside pick because rank upside is ${round(components.rankUpside)} and final-prize equity delta is ${context.finalPrizeEquityDeltaPlanck ?? 'n/a'} planck.`,
      'Use this when catching rank or improving top-five equity is more important than pure forecast safety.',
    ];
  }
  return [
    `${score} is the balanced pick selected by the active risk utility ${round(context.candidate.utility)}.`,
    'Use this as the default recommendation when no special tournament posture overrides it.',
  ];
}

function buildWarnings(picks: AlternativePickRecommendation[], contexts: CandidateContext[]): string[] {
  const warnings: string[] = [];
  if (contexts.length === 0) warnings.push('No risk candidates were available for alternative-pick selection.');
  const seen = new Map<string, AlternativePickKind[]>();
  for (const pick of picks) {
    const key = scoreKey(pick.score);
    seen.set(key, [...(seen.get(key) ?? []), pick.kind]);
  }
  for (const [key, kinds] of seen) {
    if (kinds.length > 1) {
      warnings.push(`Alternative pick overlap: ${key} was selected for ${kinds.join(', ')}.`);
    }
  }
  if (picks.some((pick) => pick.topFiveProbability === null)) {
    warnings.push('Some alternative picks lack opponent-aware top-five data because simulation or indexer inputs were partial.');
  }
  return warnings;
}

function summarize(picks: AlternativePickRecommendation[]): string {
  if (picks.length === 0) return 'Alternative picks unavailable.';
  return picks.map((pick) => `${pick.label}: ${formatScore(pick.score)}`).join('; ');
}

function labelForKind(kind: AlternativePickKind): string {
  if (kind === 'safest') return 'Safest pick';
  if (kind === 'balanced') return 'Balanced pick';
  if (kind === 'contrarian') return 'Contrarian pick';
  return 'Leaderboard-upside pick';
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function formatScore(score: Score): string {
  return `${score.home}-${score.away}`;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
