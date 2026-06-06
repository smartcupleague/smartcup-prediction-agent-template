import type { MatchRatingView, Score, SmartCupMatch } from '../types/index.js';
import { TeamRatingModel } from './team-rating-model.js';

export type ScoreProbability = {
  score: Score;
  probability: number;
};

export type OutcomeProbabilities = {
  home: number;
  draw: number;
  away: number;
};

export type AdvancementProbabilities = {
  home: number;
  away: number;
};

export type PenaltyWinnerProbabilities = {
  Home: number;
  Away: number;
};

export type ExpectedGoals = {
  home: number;
  away: number;
};

export type ScoreMatrixCell = ScoreProbability & {
  outcome: keyof OutcomeProbabilities;
  penaltyWinnerProbabilities?: PenaltyWinnerProbabilities;
};

export type ForecastProbabilityChecks = {
  scoreProbabilityMass: number;
  residualProbabilityMass: number;
  normalizedOutcomeProbabilityMass: number;
  scoreMassWithinTolerance: boolean;
  outcomeMassWithinTolerance: boolean;
};

export type ScoreMatrixForecast = {
  matchId: string;
  model: 'independent_poisson_v1';
  generatedAt: string;
  maxGoals: number;
  expectedGoals: ExpectedGoals;
  outcomeProbabilities: OutcomeProbabilities;
  rankedScores: ScoreMatrixCell[];
  matrixProbabilityMass: number;
  residualProbabilityMass: number;
  probabilityChecks: ForecastProbabilityChecks;
  knockout: {
    isKnockout: boolean;
    drawResolutionRequired: boolean;
    penaltyWinnerProbabilities: PenaltyWinnerProbabilities | null;
    advancementProbabilities: AdvancementProbabilities | null;
  };
  rating: MatchRatingView;
  confidence: number;
};

export type ForecastModelOptions = {
  maxGoals?: number;
  baseExpectedGoals?: number;
  goalSensitivity?: number;
  minExpectedGoals?: number;
  maxExpectedGoals?: number;
  teamRatings?: TeamRatingModel;
};

export class ForecastModel {
  private readonly teamRatings: TeamRatingModel;
  private readonly maxGoals: number;
  private readonly baseExpectedGoals: number;
  private readonly goalSensitivity: number;
  private readonly minExpectedGoals: number;
  private readonly maxExpectedGoals: number;

  constructor(options: ForecastModelOptions | TeamRatingModel = {}) {
    if (options instanceof TeamRatingModel) {
      this.teamRatings = options;
      this.maxGoals = 6;
      this.baseExpectedGoals = 1.35;
      this.goalSensitivity = 0.0032;
      this.minExpectedGoals = 0.25;
      this.maxExpectedGoals = 3.5;
      return;
    }

    this.teamRatings = options.teamRatings ?? new TeamRatingModel();
    this.maxGoals = options.maxGoals ?? 6;
    this.baseExpectedGoals = options.baseExpectedGoals ?? 1.35;
    this.goalSensitivity = options.goalSensitivity ?? 0.0032;
    this.minExpectedGoals = options.minExpectedGoals ?? 0.25;
    this.maxExpectedGoals = options.maxExpectedGoals ?? 3.5;
  }

  rankScores(match: SmartCupMatch): ScoreProbability[] {
    return this.forecastScoreMatrix(match).rankedScores;
  }

  forecastScoreMatrix(match: SmartCupMatch): ScoreMatrixForecast {
    const rating = this.teamRatings.rateMatch(match);
    const expectedGoals = this.expectedGoalsFromRating(rating);
    const homeGoalProbabilities = poissonProbabilities(expectedGoals.home, this.maxGoals);
    const awayGoalProbabilities = poissonProbabilities(expectedGoals.away, this.maxGoals);
    const rankedScores: ScoreMatrixCell[] = [];
    const outcomeProbabilities: OutcomeProbabilities = { home: 0, draw: 0, away: 0 };
    const isKnockout = isKnockoutPhase(match.phase);
    const penaltyWinnerProbabilities = isKnockout ? penaltyProbabilitiesFromRating(rating) : null;
    let matrixProbabilityMass = 0;

    for (let home = 0; home <= this.maxGoals; home += 1) {
      for (let away = 0; away <= this.maxGoals; away += 1) {
        const probability = (homeGoalProbabilities[home] ?? 0) * (awayGoalProbabilities[away] ?? 0);
        const outcome = scoreOutcome({ home, away });
        outcomeProbabilities[outcome] += probability;
        matrixProbabilityMass += probability;
        const cell: ScoreMatrixCell = {
          score: { home, away },
          probability,
          outcome,
        };

        if (outcome === 'draw' && penaltyWinnerProbabilities) {
          cell.penaltyWinnerProbabilities = penaltyWinnerProbabilities;
        }

        rankedScores.push(cell);
      }
    }

    rankedScores.sort((left, right) => right.probability - left.probability);

    return {
      matchId: match.matchId,
      model: 'independent_poisson_v1',
      generatedAt: new Date().toISOString(),
      maxGoals: this.maxGoals,
      expectedGoals,
      outcomeProbabilities: normalizeOutcomeProbabilities(outcomeProbabilities, matrixProbabilityMass),
      rankedScores,
      matrixProbabilityMass,
      residualProbabilityMass: Math.max(0, 1 - matrixProbabilityMass),
      probabilityChecks: buildProbabilityChecks(matrixProbabilityMass, outcomeProbabilities),
      knockout: {
        isKnockout,
        drawResolutionRequired: isKnockout,
        penaltyWinnerProbabilities,
        advancementProbabilities: penaltyWinnerProbabilities
          ? buildAdvancementProbabilities(
              normalizeOutcomeProbabilities(outcomeProbabilities, matrixProbabilityMass),
              penaltyWinnerProbabilities,
            )
          : null,
      },
      rating,
      confidence: Number((rating.confidence * matrixProbabilityMass).toFixed(4)),
    };
  }

  private expectedGoalsFromRating(rating: MatchRatingView): ExpectedGoals {
    const homeStrengthDelta = (rating.adjustedHomeRating - 1500) * this.goalSensitivity;
    const awayStrengthDelta = (rating.adjustedAwayRating - 1500) * this.goalSensitivity;

    return {
      home: clamp(this.baseExpectedGoals + homeStrengthDelta, this.minExpectedGoals, this.maxExpectedGoals),
      away: clamp(this.baseExpectedGoals + awayStrengthDelta, this.minExpectedGoals, this.maxExpectedGoals),
    };
  }
}

function poissonProbabilities(lambda: number, maxGoals: number): number[] {
  const probabilities: number[] = [];
  let probability = Math.exp(-lambda);
  probabilities.push(probability);

  for (let goals = 1; goals <= maxGoals; goals += 1) {
    probability *= lambda / goals;
    probabilities.push(probability);
  }

  return probabilities;
}

function scoreOutcome(score: Score): keyof OutcomeProbabilities {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function isKnockoutPhase(phase: string): boolean {
  const normalized = phase.toLowerCase();
  if (normalized.includes('group')) return false;

  return (
    normalized.includes('round of') ||
    normalized.includes('r32') ||
    normalized.includes('r16') ||
    normalized.includes('quarter') ||
    normalized.includes('semi') ||
    normalized.includes('third') ||
    normalized.includes('final')
  );
}

function penaltyProbabilitiesFromRating(rating: MatchRatingView): PenaltyWinnerProbabilities {
  const ratingSignal = rating.expectedHomeResult - 0.5;
  const home = clamp(0.5 + ratingSignal * 0.65, 0.35, 0.65);

  return {
    Home: home,
    Away: 1 - home,
  };
}

function buildAdvancementProbabilities(
  outcomes: OutcomeProbabilities,
  penalties: PenaltyWinnerProbabilities,
): AdvancementProbabilities {
  return {
    home: outcomes.home + outcomes.draw * penalties.Home,
    away: outcomes.away + outcomes.draw * penalties.Away,
  };
}

function normalizeOutcomeProbabilities(
  outcomes: OutcomeProbabilities,
  matrixProbabilityMass: number,
): OutcomeProbabilities {
  if (matrixProbabilityMass <= 0) return outcomes;

  return {
    home: outcomes.home / matrixProbabilityMass,
    draw: outcomes.draw / matrixProbabilityMass,
    away: outcomes.away / matrixProbabilityMass,
  };
}

function buildProbabilityChecks(
  matrixProbabilityMass: number,
  rawOutcomeProbabilities: OutcomeProbabilities,
): ForecastProbabilityChecks {
  const residualProbabilityMass = Math.max(0, 1 - matrixProbabilityMass);
  const normalizedOutcomeProbabilityMass =
    (rawOutcomeProbabilities.home + rawOutcomeProbabilities.draw + rawOutcomeProbabilities.away) /
    matrixProbabilityMass;

  return {
    scoreProbabilityMass: matrixProbabilityMass,
    residualProbabilityMass,
    normalizedOutcomeProbabilityMass,
    scoreMassWithinTolerance: Math.abs(matrixProbabilityMass + residualProbabilityMass - 1) < 1e-9,
    outcomeMassWithinTolerance: Math.abs(normalizedOutcomeProbabilityMass - 1) < 1e-9,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
