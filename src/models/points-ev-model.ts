import type {
  CandidatePointsEv,
  CandidatePointsEvReport,
  PoolOutcome,
  SmartCupMatch,
  TournamentProfile,
} from '../types/index.js';
import { getPhaseWeight } from '../tournament/index.js';
import type { ScoreMatrixForecast } from './forecast-model.js';

export type PointsEvModelOptions = {
  topCandidates?: number;
};

export class PointsEvModel {
  private readonly topCandidates: number;

  constructor(options: PointsEvModelOptions = {}) {
    this.topCandidates = options.topCandidates ?? 12;
  }

  computeCandidatePointsEv(
    match: SmartCupMatch,
    forecast: ScoreMatrixForecast,
    profile: TournamentProfile,
  ): CandidatePointsEvReport {
    const phaseWeight = getPhaseWeight(profile, match.phase) ?? 1;
    const candidates = forecast.rankedScores.map((cell) => {
      const exactScoreProbability = cell.probability;
      const outcomeProbability = forecast.outcomeProbabilities[cell.outcome];
      const outcomeOnlyProbability = Math.max(0, outcomeProbability - exactScoreProbability);
      const expectedBasePoints =
        exactScoreProbability * profile.scoring.exactScorePoints +
        outcomeOnlyProbability * profile.scoring.correctOutcomePoints;
      const expectedWeightedPoints = profile.scoring.phaseWeightsApply
        ? expectedBasePoints * phaseWeight
        : expectedBasePoints;

      return {
        score: cell.score,
        outcome: cell.outcome as PoolOutcome,
        exactScoreProbability: round(exactScoreProbability),
        outcomeProbability: round(outcomeProbability),
        exactScorePoints: profile.scoring.exactScorePoints,
        outcomePoints: profile.scoring.correctOutcomePoints,
        phaseWeight,
        expectedBasePoints: round(expectedBasePoints),
        expectedWeightedPoints: round(expectedWeightedPoints),
      } satisfies CandidatePointsEv;
    });

    candidates.sort((left, right) => {
      const pointsDiff = right.expectedWeightedPoints - left.expectedWeightedPoints;
      if (Math.abs(pointsDiff) > 1e-12) return pointsDiff;
      return right.exactScoreProbability - left.exactScoreProbability;
    });

    return {
      matchId: match.matchId,
      generatedAt: new Date().toISOString(),
      model: 'smartcup_points_ev_v1',
      phase: match.phase,
      phaseWeight,
      scoring: profile.scoring,
      candidates,
      topByExpectedWeightedPoints: candidates.slice(0, this.topCandidates),
      assumptions: [
        'Exact-score probability comes from the current score matrix.',
        'Outcome probability comes from normalized home/draw/away forecast mass.',
        'Expected base points = P(exact score) * exact score points + P(correct outcome but not exact score) * correct outcome points.',
        'Expected weighted points applies the live reconciled SmartCup phase weight when phaseWeightsApply is true.',
      ],
    };
  }
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
