import type {
  ActorId,
  CandidateLeaderboardEquity,
  CandidatePointsEvReport,
  FinalPrizeDistributionEntry,
  IoSmartCupState,
  LeaderboardEquityReport,
  LeaderboardProjectedRow,
  TournamentProfile,
  U128String,
  UserPointsEntry,
} from '../types/index.js';

export type LeaderboardModelOptions = {
  topCandidates?: number;
};

export class LeaderboardModel {
  private readonly topCandidates: number;

  constructor(options: LeaderboardModelOptions = {}) {
    this.topCandidates = options.topCandidates ?? 12;
  }

  simulateTopFiveEquity(
    pointsEv: CandidatePointsEvReport,
    state: Pick<IoSmartCupState, 'user_points' | 'final_prize_accumulated'>,
    profile: TournamentProfile,
    wallet: ActorId,
  ): LeaderboardEquityReport {
    const finalPrizePool = toBigInt(state.final_prize_accumulated);
    const baseRows = buildBaseRows(state.user_points, wallet);
    const currentRows = rankRows(baseRows, profile.finalPrize.distribution, finalPrizePool);
    const currentWallet = currentRows.find((row) => sameWallet(row.wallet, wallet)) ?? currentRows[0];
    if (!currentWallet) throw new Error(`Unable to project leaderboard for wallet ${wallet}`);

    const candidates = pointsEv.candidates.map((candidate) => {
      const projectedRows = rankRows(
        baseRows.map((row) =>
          sameWallet(row.wallet, wallet)
            ? { ...row, projectedPoints: row.currentPoints + candidate.expectedWeightedPoints }
            : row,
        ),
        profile.finalPrize.distribution,
        finalPrizePool,
      );
      const projectedWallet = projectedRows.find((row) => sameWallet(row.wallet, wallet));
      if (!projectedWallet) throw new Error(`Projected wallet row missing for ${wallet}`);

      return {
        score: candidate.score,
        outcome: candidate.outcome,
        expectedWeightedPoints: candidate.expectedWeightedPoints,
        projectedWalletPoints: round(projectedWallet.projectedPoints),
        projectedRank: projectedWallet.projectedRank,
        topFive: projectedWallet.projectedRank <= profile.finalPrize.placesPaid,
        finalPrizeBps: projectedWallet.finalPrizeBps,
        finalPrizeEquityPlanck: projectedWallet.finalPrizeEquityPlanck,
        equityDeltaPlanck: (toBigInt(projectedWallet.finalPrizeEquityPlanck) - toBigInt(currentWallet.finalPrizeEquityPlanck)).toString(),
      } satisfies CandidateLeaderboardEquity;
    });

    candidates.sort((left, right) => {
      const equityDiff = toSignedBigInt(right.equityDeltaPlanck) - toSignedBigInt(left.equityDeltaPlanck);
      if (equityDiff > 0n) return 1;
      if (equityDiff < 0n) return -1;
      return right.expectedWeightedPoints - left.expectedWeightedPoints;
    });

    return {
      matchId: pointsEv.matchId,
      generatedAt: new Date().toISOString(),
      model: 'current_board_points_equity_v1',
      wallet,
      currentWalletPoints: currentWallet.currentPoints,
      currentRank: currentWallet.projectedRank,
      currentFinalPrizeBps: currentWallet.finalPrizeBps,
      currentFinalPrizeEquityPlanck: currentWallet.finalPrizeEquityPlanck,
      finalPrizePoolPlanck: finalPrizePool.toString(),
      placesPaid: profile.finalPrize.placesPaid,
      candidates,
      topByEquity: candidates.slice(0, this.topCandidates),
      currentTopFive: currentRows.slice(0, profile.finalPrize.placesPaid),
      assumptions: [
        'Simulation uses current on-chain user_points as the leaderboard baseline.',
        'Each candidate adds its expected weighted points to the operator wallet only.',
        'Other users are held static; opponent future predictions are not simulated yet.',
        'Final-prize equity applies the tournament top-5 distribution to the current final_prize_accumulated amount.',
        'Tie groups combine final-prize positions and split them evenly according to SmartCup tie policy.',
      ],
    };
  }
}

type BaseLeaderboardRow = {
  wallet: ActorId | string;
  currentPoints: number;
  projectedPoints: number;
};

function buildBaseRows(userPoints: UserPointsEntry[], wallet: ActorId): BaseLeaderboardRow[] {
  const rows = userPoints.map((entry) => ({
    wallet: entry.actor_id,
    currentPoints: entry.points,
    projectedPoints: entry.points,
  }));

  if (!rows.some((row) => sameWallet(row.wallet, wallet))) {
    rows.push({ wallet, currentPoints: 0, projectedPoints: 0 });
  }

  return rows;
}

function rankRows(
  rows: BaseLeaderboardRow[],
  distribution: FinalPrizeDistributionEntry[],
  finalPrizePool: bigint,
): LeaderboardProjectedRow[] {
  const sorted = [...rows].sort((left, right) => {
    const pointsDiff = right.projectedPoints - left.projectedPoints;
    if (Math.abs(pointsDiff) > 1e-9) return pointsDiff;
    return String(left.wallet).localeCompare(String(right.wallet));
  });
  const ranked: LeaderboardProjectedRow[] = [];
  let index = 0;

  while (index < sorted.length) {
    const first = sorted[index];
    if (!first) break;
    const group = [first];
    let next = index + 1;
    while (next < sorted.length && Math.abs((sorted[next]?.projectedPoints ?? 0) - first.projectedPoints) <= 1e-9) {
      group.push(sorted[next] as BaseLeaderboardRow);
      next += 1;
    }

    const rank = index + 1;
    const finalPrizeBps = splitBpsForTieGroup(rank, group.length, distribution);
    const equity = (finalPrizePool * BigInt(Math.round(finalPrizeBps * 1_000_000))) / 1_000_000n / 10_000n;

    for (const row of group) {
      ranked.push({
        wallet: row.wallet,
        currentPoints: row.currentPoints,
        projectedPoints: round(row.projectedPoints),
        projectedRank: rank,
        finalPrizeBps: round(finalPrizeBps),
        finalPrizeEquityPlanck: equity.toString(),
      });
    }

    index = next;
  }

  return ranked.sort((left, right) => {
    const rankDiff = left.projectedRank - right.projectedRank;
    if (rankDiff !== 0) return rankDiff;
    return String(left.wallet).localeCompare(String(right.wallet));
  });
}

function splitBpsForTieGroup(rank: number, groupSize: number, distribution: FinalPrizeDistributionEntry[]): number {
  let totalBps = 0;
  for (let place = rank; place < rank + groupSize; place += 1) {
    totalBps += distribution.find((entry) => entry.place === place)?.bps ?? 0;
  }
  return groupSize <= 0 ? 0 : totalBps / groupSize;
}

function sameWallet(left: ActorId | string, right: ActorId | string): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
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
