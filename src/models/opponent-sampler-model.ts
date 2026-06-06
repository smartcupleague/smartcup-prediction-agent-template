import type {
  ExactScoreCrowdingReport,
  OpponentPredictionSample,
  OpponentPredictionSamplerReport,
  OpponentProfile,
  OpponentScoreDistributionEntry,
  PoolOutcome,
  Score,
  SmartCupMatch,
} from '../types/index.js';
import type { ScoreMatrixForecast, ScoreMatrixCell } from './forecast-model.js';

export type OpponentSamplerOptions = {
  seed?: string;
  topScores?: number;
};

type WeightedCandidate = {
  cell: ScoreMatrixCell;
  crowdShare: number;
  weight: number;
  signals: string[];
};

export class OpponentSamplerModel {
  private readonly seed: string;
  private readonly topScores: number;

  constructor(options: OpponentSamplerOptions = {}) {
    this.seed = options.seed ?? 'smartcup-agent';
    this.topScores = options.topScores ?? 8;
  }

  sampleOpponentPredictions(
    match: SmartCupMatch,
    forecast: ScoreMatrixForecast,
    crowding: ExactScoreCrowdingReport,
    opponents: OpponentProfile[],
  ): OpponentPredictionSamplerReport {
    const samples = opponents.map((opponent) => this.sampleOne(match, forecast, crowding, opponent));
    const expectedParticipants = samples.reduce((sum, sample) => sum + sample.participationProbability, 0);

    return {
      matchId: match.matchId,
      generatedAt: new Date().toISOString(),
      model: 'opponent_archetype_sampler_v1',
      seed: this.seed,
      phase: match.phase,
      totalOpponents: opponents.length,
      expectedParticipants: round(expectedParticipants),
      samples,
      assumptions: [
        'Participation probability is derived from opponent participation history, rank pressure, phase, and sample quality.',
        'Score distributions combine forecast probability, visible crowding, opponent archetype, and rank-pressure behavior.',
        'The selected score is deterministic for a given seed and wallet, so Monte Carlo runs can be reproducible.',
        'Sparse profiles remain conservative; unknown archetypes use blended forecast and public-score behavior.',
      ],
    };
  }

  private sampleOne(
    match: SmartCupMatch,
    forecast: ScoreMatrixForecast,
    crowding: ExactScoreCrowdingReport,
    opponent: OpponentProfile,
  ): OpponentPredictionSample {
    const participationProbability = participationProbabilityFor(match, opponent);
    const participationRoll = seededUnit(`${this.seed}:${match.matchId}:${opponent.wallet}:participate`);
    const willParticipate = participationRoll <= participationProbability;
    const distribution = buildDistribution(match, forecast, crowding, opponent, this.topScores);
    const selectionRoll = seededUnit(`${this.seed}:${match.matchId}:${opponent.wallet}:score`);
    const selected = willParticipate ? selectFromDistribution(distribution, selectionRoll) : null;

    return {
      wallet: opponent.wallet,
      displayName: opponent.displayName,
      archetype: opponent.archetype,
      archetypeConfidence: opponent.archetypeConfidence,
      currentPoints: opponent.rankPressure.currentPoints,
      participationProbability: round(participationProbability),
      willParticipate,
      selectedScore: selected?.score ?? null,
      selectedOutcome: selected?.outcome ?? null,
      rankPressureMode: opponent.rankPressure.pressureMode,
      distributionTop: distribution.slice(0, this.topScores),
    };
  }
}

function buildDistribution(
  match: SmartCupMatch,
  forecast: ScoreMatrixForecast,
  crowding: ExactScoreCrowdingReport,
  opponent: OpponentProfile,
  limit: number,
): OpponentScoreDistributionEntry[] {
  const crowdByScore = new Map(crowding.scoreEstimates.map((estimate) => [scoreKey(estimate.score), estimate]));
  const favoriteOutcome = favoriteOutcomeFromForecast(forecast);
  const weighted = forecast.rankedScores.map((cell) => {
    const crowdShare = crowdByScore.get(scoreKey(cell.score))?.estimatedShareOfMatchPool ?? 0;
    return weightCandidate(match, cell, crowdShare, opponent, favoriteOutcome);
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const normalized = weighted
    .map((item) => ({
      score: item.cell.score,
      outcome: item.cell.outcome as PoolOutcome,
      probability: totalWeight <= 0 ? 0 : item.weight / totalWeight,
      forecastProbability: item.cell.probability,
      crowdShare: item.crowdShare,
      signals: item.signals,
    }))
    .sort((left, right) => right.probability - left.probability);

  const topMass = normalized.slice(0, limit).reduce((sum, entry) => sum + entry.probability, 0);
  if (topMass <= 0) return normalized.slice(0, limit);

  return normalized.map((entry) => ({
    ...entry,
    probability: round(entry.probability),
    forecastProbability: round(entry.forecastProbability),
    crowdShare: round(entry.crowdShare),
  }));
}

function weightCandidate(
  match: SmartCupMatch,
  cell: ScoreMatrixCell,
  crowdShare: number,
  opponent: OpponentProfile,
  favoriteOutcome: PoolOutcome,
): WeightedCandidate {
  const signals: string[] = [];
  const outcomeProbability = Math.max(0.0001, cell.probability);
  let weight = Math.pow(outcomeProbability, 0.85);
  const totalGoals = cell.score.home + cell.score.away;
  const margin = Math.abs(cell.score.home - cell.score.away);
  const common = isCommonScore(cell.score);

  if (opponent.archetype === 'public_score') {
    weight *= common ? 2.2 : 0.8;
    weight *= 1 + crowdShare * 4;
    signals.push('public_score favors common and crowded scores');
  } else if (opponent.archetype === 'favorite_chaser') {
    weight *= cell.outcome === favoriteOutcome ? 2.1 : 0.55;
    weight *= common ? 1.35 : 0.9;
    signals.push('favorite_chaser favors likely winner outcomes');
  } else if (opponent.archetype === 'contrarian') {
    weight *= 1 + Math.max(0, 0.35 - crowdShare) * 3;
    weight *= common ? 0.75 : 1.35;
    signals.push('contrarian avoids crowded public scores');
  } else if (opponent.archetype === 'high_variance') {
    weight *= totalGoals >= 4 || margin >= 2 ? 2.0 : 0.75;
    signals.push('high_variance favors larger totals or margins');
  } else if (opponent.archetype === 'leader_protect') {
    weight *= cell.outcome === favoriteOutcome ? 1.8 : 0.75;
    weight *= common ? 1.6 : 0.75;
    signals.push('leader_protect favors safer common outcomes');
  } else if (opponent.archetype === 'catch_up') {
    weight *= totalGoals >= 3 || margin >= 2 ? 1.65 : 0.9;
    weight *= 1 + Math.max(0, 0.25 - crowdShare) * 2.5;
    signals.push('catch_up accepts variance and lower-crowd scores');
  } else if (opponent.archetype === 'inactive') {
    weight *= common ? 1.2 : 0.9;
    signals.push('inactive fallback uses light public-score bias');
  } else {
    weight *= common ? 1.15 : 1;
    weight *= 1 + crowdShare;
    signals.push('unknown blends forecast and public crowd signals');
  }

  if (opponent.rankPressure.pressureMode === 'leader' || opponent.rankPressure.pressureMode === 'top_five') {
    weight *= common ? 1.25 : 0.95;
    signals.push(`rank pressure ${opponent.rankPressure.pressureMode} nudges safer scores`);
  }
  if (opponent.rankPressure.pressureMode === 'bubble' || opponent.rankPressure.pressureMode === 'chasing') {
    weight *= totalGoals >= 3 ? 1.15 : 0.98;
    signals.push(`rank pressure ${opponent.rankPressure.pressureMode} nudges variance`);
  }

  return { cell, crowdShare, weight: Math.max(0.000001, weight), signals };
}

function participationProbabilityFor(match: SmartCupMatch, opponent: OpponentProfile): number {
  let probability = opponent.participation.recentParticipationRate ?? opponent.participation.participationRate;
  if (opponent.archetype === 'inactive') probability *= 0.45;
  if (opponent.rankPressure.pressureMode === 'leader' || opponent.rankPressure.pressureMode === 'top_five') probability += 0.12;
  if (opponent.rankPressure.pressureMode === 'bubble' || opponent.rankPressure.pressureMode === 'chasing') probability += 0.1;
  if (isKnockoutOrLatePhase(match.phase)) probability += 0.08;
  if (opponent.sampleQuality.label === 'low') probability = Math.max(probability, opponent.participation.predictionsObserved > 0 ? 0.08 : 0.02);
  return clamp(probability, 0.01, 0.98);
}

function selectFromDistribution(
  distribution: OpponentScoreDistributionEntry[],
  roll: number,
): OpponentScoreDistributionEntry | null {
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += entry.probability;
    if (roll <= cumulative) return entry;
  }
  return distribution[0] ?? null;
}

function favoriteOutcomeFromForecast(forecast: ScoreMatrixForecast): PoolOutcome {
  const entries = Object.entries(forecast.outcomeProbabilities) as Array<[PoolOutcome, number]>;
  return entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'home';
}

function isCommonScore(score: Score): boolean {
  return ['1-0', '2-1', '1-1', '2-0', '0-1', '0-0', '1-2', '2-2'].includes(scoreKey(score));
}

function isKnockoutOrLatePhase(phase: string): boolean {
  const normalized = phase.toLowerCase();
  return (
    normalized.includes('round') ||
    normalized.includes('quarter') ||
    normalized.includes('semi') ||
    normalized.includes('third') ||
    normalized.includes('final')
  );
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function seededUnit(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
