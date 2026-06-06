import type {
  AgentConfig,
  EntrySplitBreakdown,
  MatchPoolDistributionView,
  PoolOutcomeDistribution,
  SmartCupApiPoolDistribution,
  TournamentRewardSplit,
  U128String,
} from '../types/index.js';
import { SmartCupApiAdapter } from './smartcup-api-adapter.js';

const BPS_DENOMINATOR = 10_000n;

export class PoolDistributionAdapter {
  private readonly api: SmartCupApiAdapter;
  private readonly splitBps: TournamentRewardSplit;

  constructor(config: AgentConfig, api = new SmartCupApiAdapter(config.services.smartcupApiUrl)) {
    this.api = api;
    this.splitBps = {
      matchWinnerPoolBps: config.economics.matchWinnerPoolBps,
      finalPrizePoolBps: config.economics.finalPrizePoolBps,
      protocolFeeBps: config.economics.protocolFeeBps,
    };
    assertValidSplit(this.splitBps);
  }

  splitEntry(grossEntryPlanck: U128String | bigint | number): EntrySplitBreakdown {
    const gross = toBigInt(grossEntryPlanck);
    const matchWinner = applyBps(gross, this.splitBps.matchWinnerPoolBps);
    const finalPrize = applyBps(gross, this.splitBps.finalPrizePoolBps);
    const protocolFee = applyBps(gross, this.splitBps.protocolFeeBps);
    const dust = gross - matchWinner - finalPrize - protocolFee;

    return {
      grossEntryPlanck: gross.toString(),
      matchWinnerPoolPlanck: matchWinner.toString(),
      finalPrizePoolPlanck: finalPrize.toString(),
      protocolFeePlanck: protocolFee.toString(),
      dustPlanck: dust.toString(),
      splitBps: this.splitBps,
    };
  }

  fromApiPool(pool: SmartCupApiPoolDistribution, generatedAt = new Date().toISOString()): MatchPoolDistributionView {
    const totalMatchPool = toBigInt(pool.total_planck);
    const inferredGross = inferGrossFromMatchPool(totalMatchPool, this.splitBps.matchWinnerPoolBps);
    const split = this.splitEntry(inferredGross);
    const outcomes = buildOutcomeDistributions(pool);

    return {
      matchId: pool.match_id,
      source: 'smartcup_api',
      generatedAt,
      splitBps: this.splitBps,
      totalBets: pool.total_bets,
      totalMatchPoolPlanck: totalMatchPool.toString(),
      inferredGrossEntryPlanck: inferredGross.toString(),
      inferredFinalPrizeContributionPlanck: split.finalPrizePoolPlanck,
      inferredProtocolFeePlanck: split.protocolFeePlanck,
      inferredDustPlanck: split.dustPlanck,
      outcomes,
    };
  }

  async getMatchPool(matchId: string | number | bigint): Promise<MatchPoolDistributionView> {
    return this.fromApiPool(await this.api.getPoolDistribution(matchId));
  }

  async listMatchPools(): Promise<MatchPoolDistributionView[]> {
    const generatedAt = new Date().toISOString();
    const response = await this.api.getPoolDistributions();
    return response.pools.map((pool) => this.fromApiPool(pool, generatedAt));
  }
}

function buildOutcomeDistributions(pool: SmartCupApiPoolDistribution): PoolOutcomeDistribution[] {
  const totalPlanck = toBigInt(pool.total_planck);
  const totalBets = pool.total_bets;
  return [
    outcomeDistribution('home', pool.home_bets, pool.home_planck, totalBets, totalPlanck),
    outcomeDistribution('draw', pool.draw_bets, pool.draw_planck, totalBets, totalPlanck),
    outcomeDistribution('away', pool.away_bets, pool.away_planck, totalBets, totalPlanck),
  ];
}

function outcomeDistribution(
  outcome: PoolOutcomeDistribution['outcome'],
  bets: number,
  matchPoolPlanck: U128String,
  totalBets: number,
  totalPlanck: bigint,
): PoolOutcomeDistribution {
  const planck = toBigInt(matchPoolPlanck);
  return {
    outcome,
    bets,
    matchPoolPlanck: planck.toString(),
    shareOfMatchPool: totalPlanck === 0n ? 0 : Number(planck) / Number(totalPlanck),
    shareOfBets: totalBets === 0 ? 0 : bets / totalBets,
  };
}

function applyBps(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / BPS_DENOMINATOR;
}

function inferGrossFromMatchPool(matchPoolPlanck: bigint, matchWinnerPoolBps: number): bigint {
  if (matchWinnerPoolBps <= 0) throw new Error('matchWinnerPoolBps must be greater than zero.');
  return (matchPoolPlanck * BPS_DENOMINATOR) / BigInt(matchWinnerPoolBps);
}

function assertValidSplit(split: TournamentRewardSplit): void {
  const total = split.matchWinnerPoolBps + split.finalPrizePoolBps + split.protocolFeeBps;
  if (total !== Number(BPS_DENOMINATOR)) {
    throw new Error(`Invalid SmartCup entry split: expected 10000 bps, got ${total}.`);
  }
}

function toBigInt(value: U128String | bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid non-negative safe integer planck value: ${value}`);
    }
    return BigInt(value);
  }
  if (!/^\d+$/.test(value)) throw new Error(`Invalid planck value: ${value}`);
  return BigInt(value);
}
