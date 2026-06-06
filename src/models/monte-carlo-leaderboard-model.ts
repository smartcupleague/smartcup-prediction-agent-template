import type {
  ActorId,
  CandidatePointsEvReport,
  FinalPrizeDistributionEntry,
  IoSmartCupState,
  MonteCarloBlockerWallet,
  MonteCarloCandidateSummary,
  MonteCarloLeaderboardSimulationReport,
  OpponentPredictionSample,
  OpponentScoreDistributionEntry,
  PoolOutcome,
  Score,
  TournamentProfile,
  U128String,
  UserPointsEntry,
} from '../types/index.js';
import type { ScoreMatrixCell, ScoreMatrixForecast } from './forecast-model.js';

export type MonteCarloLeaderboardOptions = {
  iterations?: number;
  seed?: string;
  candidateLimit?: number;
};

type LeaderboardRow = {
  wallet: ActorId | string;
  points: number;
};

type RankedRow = LeaderboardRow & {
  rank: number;
  finalPrizeBps: number;
  finalPrizeEquityPlanck: U128String;
};

type CandidateAccumulator = {
  ranks: number[];
  equityTotal: bigint;
  topOne: number;
  topThree: number;
  topFive: number;
  blockerCounts: Map<string, { wallet: ActorId | string; count: number }>;
};

export class MonteCarloLeaderboardModel {
  private readonly iterations: number;
  private readonly seed: string;
  private readonly candidateLimit: number;

  constructor(options: MonteCarloLeaderboardOptions = {}) {
    this.iterations = positiveInteger(options.iterations, 2000);
    this.seed = options.seed ?? 'smartcup-agent';
    this.candidateLimit = positiveInteger(options.candidateLimit, 12);
  }

  simulateCandidateScores(
    params: {
      forecast: ScoreMatrixForecast;
      pointsEv: CandidatePointsEvReport;
      opponentSamples: OpponentPredictionSample[];
      state: Pick<IoSmartCupState, 'user_points' | 'final_prize_accumulated'>;
      profile: TournamentProfile;
      wallet: ActorId;
    },
  ): MonteCarloLeaderboardSimulationReport {
    const finalPrizePool = toBigInt(params.state.final_prize_accumulated);
    const baseRows = buildBaseRows(params.state.user_points, params.opponentSamples, params.wallet);
    const currentRows = rankRows(baseRows, params.profile.finalPrize.distribution, finalPrizePool);
    const currentWallet = currentRows.find((row) => sameWallet(row.wallet, params.wallet)) ?? currentRows[0];
    if (!currentWallet) throw new Error(`Unable to find current wallet row for ${params.wallet}`);

    const candidates = params.pointsEv.candidates.slice(0, this.candidateLimit);
    const accumulators = new Map<string, CandidateAccumulator>();
    for (const candidate of candidates) {
      accumulators.set(scoreKey(candidate.score), {
        ranks: [],
        equityTotal: 0n,
        topOne: 0,
        topThree: 0,
        topFive: 0,
        blockerCounts: new Map(),
      });
    }

    for (let iteration = 0; iteration < this.iterations; iteration += 1) {
      const result = sampleForecastResult(params.forecast, seededUnit(`${this.seed}:result:${iteration}`));
      const opponentDeltas = sampleOpponentPointDeltas(
        params.opponentSamples,
        result,
        params.profile,
        params.pointsEv.phaseWeight,
        iteration,
        this.seed,
      );

      for (const candidate of candidates) {
        const candidateKey = scoreKey(candidate.score);
        const accumulator = accumulators.get(candidateKey);
        if (!accumulator) continue;

        const walletDelta = scorePrediction(candidate.score, result.score, params.profile, candidate.phaseWeight);
        const projectedRows = baseRows.map((row) => ({
          ...row,
          points:
            row.points +
            (sameWallet(row.wallet, params.wallet) ? walletDelta : 0) +
            (opponentDeltas.get(normalizeWallet(row.wallet)) ?? 0),
        }));
        const ranked = rankRows(projectedRows, params.profile.finalPrize.distribution, finalPrizePool);
        const walletRow = ranked.find((row) => sameWallet(row.wallet, params.wallet));
        if (!walletRow) continue;

        accumulator.ranks.push(walletRow.rank);
        accumulator.equityTotal += toBigInt(walletRow.finalPrizeEquityPlanck);
        if (walletRow.rank === 1) accumulator.topOne += 1;
        if (walletRow.rank <= 3) accumulator.topThree += 1;
        if (walletRow.rank <= params.profile.finalPrize.placesPaid) accumulator.topFive += 1;

        for (const row of ranked) {
          if (sameWallet(row.wallet, params.wallet)) continue;
          if (row.rank <= walletRow.rank) {
            const key = normalizeWallet(row.wallet);
            const existing = accumulator.blockerCounts.get(key) ?? { wallet: row.wallet, count: 0 };
            existing.count += 1;
            accumulator.blockerCounts.set(key, existing);
          }
        }
      }
    }

    const summaries = candidates.map((candidate) => {
      const accumulator = accumulators.get(scoreKey(candidate.score));
      if (!accumulator) throw new Error(`Missing accumulator for ${scoreKey(candidate.score)}`);
      const expectedEquity = accumulator.equityTotal / BigInt(this.iterations);
      return {
        score: candidate.score,
        outcome: candidate.outcome,
        iterations: this.iterations,
        topOneProbability: round(accumulator.topOne / this.iterations),
        topThreeProbability: round(accumulator.topThree / this.iterations),
        topFiveProbability: round(accumulator.topFive / this.iterations),
        expectedRank: round(mean(accumulator.ranks)),
        medianRank: median(accumulator.ranks),
        bestRank: Math.min(...accumulator.ranks),
        worstRank: Math.max(...accumulator.ranks),
        rankStdDev: round(stdDev(accumulator.ranks)),
        expectedFinalPrizeEquityPlanck: expectedEquity.toString() as U128String,
        equityDeltaPlanck: (expectedEquity - toBigInt(currentWallet.finalPrizeEquityPlanck)).toString(),
        blockerWallets: topBlockers(accumulator.blockerCounts, this.iterations),
      } satisfies MonteCarloCandidateSummary;
    });

    summaries.sort((left, right) => {
      const equityDiff = toSignedBigInt(right.equityDeltaPlanck) - toSignedBigInt(left.equityDeltaPlanck);
      if (equityDiff > 0n) return 1;
      if (equityDiff < 0n) return -1;
      return left.expectedRank - right.expectedRank;
    });

    return {
      matchId: params.forecast.matchId,
      generatedAt: new Date().toISOString(),
      model: 'monte_carlo_leaderboard_v1',
      seed: this.seed,
      iterations: this.iterations,
      wallet: params.wallet,
      currentWalletPoints: currentWallet.points,
      currentRank: currentWallet.rank,
      currentFinalPrizeEquityPlanck: currentWallet.finalPrizeEquityPlanck,
      finalPrizePoolPlanck: finalPrizePool.toString(),
      candidates: summaries,
      topByExpectedEquity: summaries.slice(0, this.candidateLimit),
      assumptions: [
        'Each iteration samples one match result from the forecast score matrix.',
        'Each opponent independently samples participation and exact score from the opponent sampler distribution.',
        'Candidate score is fixed per summary; only match result and opponent predictions vary.',
        'Scoring uses SmartCup exact-score points or outcome points, then applies the phase weight.',
        'Final-prize equity applies current final_prize_accumulated and the configured top-five distribution.',
      ],
    };
  }
}

function sampleForecastResult(forecast: ScoreMatrixForecast, roll: number): ScoreMatrixCell {
  const total = forecast.rankedScores.reduce((sum, cell) => sum + cell.probability, 0);
  let cumulative = 0;
  for (const cell of forecast.rankedScores) {
    cumulative += total <= 0 ? 0 : cell.probability / total;
    if (roll <= cumulative) return cell;
  }
  const fallback = forecast.rankedScores[0];
  if (!fallback) throw new Error('Forecast has no score cells');
  return fallback;
}

function sampleOpponentPointDeltas(
  samples: OpponentPredictionSample[],
  result: ScoreMatrixCell,
  profile: TournamentProfile,
  phaseWeight: number,
  iteration: number,
  seed: string,
): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const sample of samples) {
    if (seededUnit(`${seed}:opp:${sample.wallet}:participate:${iteration}`) > sample.participationProbability) continue;
    const prediction = sampleFromDistribution(
      sample.distributionTop,
      seededUnit(`${seed}:opp:${sample.wallet}:score:${iteration}`),
    );
    if (!prediction) continue;
    const delta = scorePrediction(prediction.score, result.score, profile, phaseWeight);
    deltas.set(normalizeWallet(sample.wallet), (deltas.get(normalizeWallet(sample.wallet)) ?? 0) + delta);
  }
  return deltas;
}

function sampleFromDistribution(
  distribution: OpponentScoreDistributionEntry[],
  roll: number,
): OpponentScoreDistributionEntry | null {
  const total = distribution.reduce((sum, entry) => sum + entry.probability, 0);
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += total <= 0 ? 0 : entry.probability / total;
    if (roll <= cumulative) return entry;
  }
  return distribution[0] ?? null;
}

function scorePrediction(
  prediction: Score,
  result: Score,
  profile: TournamentProfile,
  phaseWeight: number,
): number {
  const exact = prediction.home === result.home && prediction.away === result.away;
  const outcome = scoreOutcome(prediction) === scoreOutcome(result);
  const base = exact ? profile.scoring.exactScorePoints : outcome ? profile.scoring.correctOutcomePoints : profile.scoring.incorrectPoints;
  return profile.scoring.phaseWeightsApply ? base * phaseWeight : base;
}

function buildBaseRows(
  userPoints: UserPointsEntry[],
  samples: OpponentPredictionSample[],
  wallet: ActorId,
): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow>();
  for (const entry of userPoints) {
    rows.set(normalizeWallet(entry.actor_id), { wallet: entry.actor_id, points: entry.points });
  }
  for (const sample of samples) {
    const key = normalizeWallet(sample.wallet);
    if (!rows.has(key)) rows.set(key, { wallet: sample.wallet, points: sample.currentPoints });
  }
  if (!rows.has(normalizeWallet(wallet))) rows.set(normalizeWallet(wallet), { wallet, points: 0 });
  return [...rows.values()];
}

function rankRows(rows: LeaderboardRow[], distribution: FinalPrizeDistributionEntry[], finalPrizePool: bigint): RankedRow[] {
  const sorted = [...rows].sort((left, right) => {
    const diff = right.points - left.points;
    if (Math.abs(diff) > 1e-9) return diff;
    return String(left.wallet).localeCompare(String(right.wallet));
  });
  const ranked: RankedRow[] = [];
  let index = 0;
  while (index < sorted.length) {
    const first = sorted[index];
    if (!first) break;
    const group = [first];
    let next = index + 1;
    while (next < sorted.length && Math.abs((sorted[next]?.points ?? 0) - first.points) <= 1e-9) {
      group.push(sorted[next] as LeaderboardRow);
      next += 1;
    }
    const rank = index + 1;
    const finalPrizeBps = splitBpsForTieGroup(rank, group.length, distribution);
    const equity = (finalPrizePool * BigInt(Math.round(finalPrizeBps * 1_000_000))) / 1_000_000n / 10_000n;
    for (const row of group) {
      ranked.push({
        ...row,
        rank,
        finalPrizeBps: round(finalPrizeBps),
        finalPrizeEquityPlanck: equity.toString() as U128String,
      });
    }
    index = next;
  }
  return ranked;
}

function splitBpsForTieGroup(rank: number, groupSize: number, distribution: FinalPrizeDistributionEntry[]): number {
  let totalBps = 0;
  for (let place = rank; place < rank + groupSize; place += 1) {
    totalBps += distribution.find((entry) => entry.place === place)?.bps ?? 0;
  }
  return groupSize <= 0 ? 0 : totalBps / groupSize;
}

function topBlockers(
  blockers: Map<string, { wallet: ActorId | string; count: number }>,
  iterations: number,
): MonteCarloBlockerWallet[] {
  return [...blockers.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((entry) => ({ wallet: entry.wallet, aheadOrTiedRate: round(entry.count / iterations) }));
}

function scoreOutcome(score: Score): PoolOutcome {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function normalizeWallet(wallet: ActorId | string): string {
  return String(wallet).toLowerCase();
}

function sameWallet(left: ActorId | string, right: ActorId | string): boolean {
  return normalizeWallet(left) === normalizeWallet(right);
}

function seededUnit(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function toBigInt(value: U128String): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid planck value: ${value}`);
  return BigInt(value);
}

function toSignedBigInt(value: string): bigint {
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid signed planck value: ${value}`);
  return BigInt(value);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
