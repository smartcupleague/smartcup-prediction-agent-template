import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FixtureAdapter } from './fixture-adapter.js';
import { BolaoChainClient } from './bolao-chain-client.js';
import { IndexerAdapter } from './indexer-adapter.js';
import {
  loadTournamentProfile,
  reconcileTournamentProfileWithChain,
} from '../tournament/index.js';
import { MemoryStore } from '../memory/memory-store.js';
import type {
  ActorId,
  AgentConfig,
  BolaoMatch,
  EligibleMatchPlan,
  IndexerBet,
  IndexerBolaoMatch,
  PenaltyWinner,
  ResultStatus,
  StoredPrediction,
  U128String,
  U64String,
  UserBetView,
} from '../types/index.js';

const MATCH_CACHE_PATH = 'data/eligible-match-cache.json';

type EligibleMatchCache = {
  schemaVersion: 'smartpredictor.eligible-match-cache.v1';
  cachedAt: string;
  source: 'chain' | 'indexer';
  matches: BolaoMatch[];
};

export type EligibleMatchPlanReport = {
  plan: EligibleMatchPlan;
  warnings: string[];
  sources: {
    chainStateAvailable: boolean;
    chainBetCount: number;
    indexerMatchCount: number;
    indexerBetCount: number;
    localMemoryBetCount: number;
    mergedBetCount: number;
    mergedStakeInMatchPoolsPlanck: U128String;
    mergedFreebetPrincipalPlanck: U128String;
    matchSource: 'chain' | 'indexer' | 'cache';
  };
};

export async function buildEligibleMatchPlanForWallet(input: {
  config: AgentConfig;
  tournamentProfilePath: string;
  wallet?: ActorId;
}): Promise<EligibleMatchPlanReport> {
  const wallet = input.wallet ?? input.config.wallet.hexAddress;
  const warnings: string[] = [];
  const chain = new BolaoChainClient(input.config);
  const indexer = new IndexerAdapter(
    input.config.services.indexerGraphqlUrl,
    input.config.services.indexerGraphqlTimeoutMs,
  );
  const profile = await loadTournamentProfile(input.tournamentProfilePath);

  const state = await readChainState(chain, warnings);
  const chainBets = state ? await readChainWalletBets(chain, wallet, warnings) : [];
  const indexerBets = await readIndexerWalletBets(indexer, wallet, warnings);
  const localMemoryBets = readLocalMemoryWalletBets(wallet, warnings, chainBets.length === 0 || indexerBets.length === 0);
  const userBets = mergeUserBets([
    ...chainBets,
    ...indexerBets.map(indexerBetToUserBet),
    ...localMemoryBets,
  ]);
  const indexerMatches = state ? [] : await readIndexerMatches(indexer, warnings);
  let matchSource: 'chain' | 'indexer' | 'cache' = state ? 'chain' : 'indexer';
  let matches = state?.matches ?? indexerMatches.map(indexerMatchToBolaoMatch);
  if (matches.length > 0) {
    writeMatchCache(matches, matchSource);
  } else {
    const cachedMatches = readMatchCache(warnings);
    if (cachedMatches.length > 0) {
      matches = cachedMatches;
      matchSource = 'cache';
    }
  }
  if (matches.length === 0) {
    throw new Error(
      [
        'Could not build eligible-match plan: no matches were available from direct BolaoCore state or hosted indexer fallback.',
        warnings.length > 0 ? `Warnings: ${warnings.join(' | ')}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join(' '),
    );
  }

  const reconciledProfile = state ? reconcileTournamentProfileWithChain(profile, state) : profile;
  const plan = new FixtureAdapter().buildEligibleMatchPlan({
    wallet,
    matches,
    userBets,
    profile: reconciledProfile,
  });

  return {
    plan,
    warnings,
    sources: {
      chainStateAvailable: Boolean(state),
      chainBetCount: chainBets.length,
      indexerMatchCount: indexerMatches.length,
      indexerBetCount: indexerBets.length,
      localMemoryBetCount: localMemoryBets.length,
      mergedBetCount: userBets.length,
      mergedStakeInMatchPoolsPlanck: sumUserBetPlanck(userBets, 'stake_in_match_pool'),
      mergedFreebetPrincipalPlanck: sumUserBetPlanck(userBets, 'freebet_principal'),
      matchSource,
    },
  };
}

function sumUserBetPlanck(
  bets: UserBetView[],
  field: 'stake_in_match_pool' | 'freebet_principal',
): U128String {
  return bets.reduce((sum, bet) => sum + BigInt(bet[field] || '0'), 0n).toString() as U128String;
}

async function readChainState(
  chain: BolaoChainClient,
  warnings: string[],
): Promise<Awaited<ReturnType<BolaoChainClient['queryState']>> | null> {
  try {
    return await chain.queryState();
  } catch (error) {
    warnings.push(`Direct BolaoCore QueryState unavailable; using hosted indexer match fallback: ${errorMessage(error)}`);
    return null;
  }
}

async function readChainWalletBets(
  chain: BolaoChainClient,
  wallet: ActorId,
  warnings: string[],
): Promise<UserBetView[]> {
  try {
    return await chain.queryBetsByUser(wallet);
  } catch (error) {
    warnings.push(`Direct BolaoCore QueryBetsByUser unavailable; using hosted indexer duplicate filter: ${errorMessage(error)}`);
    return [];
  }
}

async function readIndexerWalletBets(
  indexer: IndexerAdapter,
  wallet: ActorId,
  warnings: string[],
): Promise<IndexerBet[]> {
  try {
    return await indexer.listBets({
      user: wallet,
      first: 500,
    });
  } catch (error) {
    warnings.push(`Indexer wallet bets unavailable for eligible-match duplicate filter: ${errorMessage(error)}`);
    return [];
  }
}

async function readIndexerMatches(
  indexer: IndexerAdapter,
  warnings: string[],
): Promise<IndexerBolaoMatch[]> {
  try {
    const matches = await indexer.listMatches({ first: 500 });
    warnings.push(`Eligible-match picker used hosted indexer match fallback (${matches.length} matches).`);
    return matches;
  } catch (error) {
    warnings.push(`Hosted indexer matches unavailable for eligible-match fallback: ${errorMessage(error)}`);
    return [];
  }
}

function readLocalMemoryWalletBets(wallet: ActorId, warnings: string[], warnWhenUsed: boolean): UserBetView[] {
  try {
    const bets = new MemoryStore()
      .listPredictions()
      .filter(
        (prediction) =>
          prediction.walletAddress.toLowerCase() === wallet.toLowerCase() &&
          prediction.source !== 'agent_recommendation',
      )
      .map(storedPredictionToUserBet);
    if (warnWhenUsed && bets.length > 0) {
      warnings.push(`Eligible-match picker merged ${bets.length} local memory prediction record(s) for duplicate filtering.`);
    }
    return bets;
  } catch (error) {
    warnings.push(`Local memory predictions unavailable for eligible-match duplicate filter: ${errorMessage(error)}`);
    return [];
  }
}

function mergeUserBets(bets: UserBetView[]): UserBetView[] {
  const byMatchId = new Map<string, UserBetView>();
  for (const bet of bets) {
    const matchId = String(bet.match_id);
    if (!byMatchId.has(matchId)) byMatchId.set(matchId, bet);
  }
  return [...byMatchId.values()];
}

function storedPredictionToUserBet(prediction: StoredPrediction): UserBetView {
  return {
    match_id: String(prediction.matchId) as U64String,
    score: prediction.score,
    penalty_winner: prediction.penaltyWinner,
    stake_in_match_pool: String(prediction.matchPoolAmountPlanck ?? prediction.amountPlanck ?? '0') as U128String,
    freebet_principal: '0',
    claimed: false,
  };
}

function writeMatchCache(matches: BolaoMatch[], source: EligibleMatchCache['source']): void {
  try {
    const cache: EligibleMatchCache = {
      schemaVersion: 'smartpredictor.eligible-match-cache.v1',
      cachedAt: new Date().toISOString(),
      source,
      matches,
    };
    mkdirSync(dirname(MATCH_CACHE_PATH), { recursive: true });
    writeFileSync(MATCH_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Cache writes are best-effort; live chain/indexer reads remain authoritative.
  }
}

function readMatchCache(warnings: string[]): BolaoMatch[] {
  try {
    if (!existsSync(MATCH_CACHE_PATH)) return [];
    const cache = JSON.parse(readFileSync(MATCH_CACHE_PATH, 'utf8')) as Partial<EligibleMatchCache>;
    if (
      cache.schemaVersion !== 'smartpredictor.eligible-match-cache.v1' ||
      !Array.isArray(cache.matches) ||
      cache.matches.length === 0
    ) {
      warnings.push('Eligible-match cache exists but is invalid or empty.');
      return [];
    }
    warnings.push(
      `Eligible-match picker used cached match snapshot from ${cache.cachedAt ?? 'unknown time'} after live match reads failed.`,
    );
    return cache.matches;
  } catch (error) {
    warnings.push(`Eligible-match cache unavailable after live match reads failed: ${errorMessage(error)}`);
    return [];
  }
}

function indexerMatchToBolaoMatch(match: IndexerBolaoMatch): BolaoMatch {
  return {
    match_id: String(match.matchId) as U64String,
    phase: match.phase,
    home: match.home,
    away: match.away,
    kick_off: String(indexerKickoffToMs(match.kickOff)) as U64String,
    result: indexerStatusToResult(match),
    match_prize_pool: String(match.prizePoolRaw ?? '0') as U128String,
    has_bets: match.betsCount > 0,
    participants: [],
    total_winner_stake: '0',
    total_claimed: '0',
    settlement_prepared: normalizeIndexerStatus(match.status) === 'SETTLED',
    dust_swept: false,
    finalized_at: normalizeIndexerStatus(match.status) === 'FINALIZED' ? String(Date.parse(match.updatedAt) || 0) as U64String : null,
  };
}

function indexerKickoffToMs(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function indexerStatusToResult(match: IndexerBolaoMatch): ResultStatus {
  const status = normalizeIndexerStatus(match.status);
  if (status === 'CANCELLED') return { kind: 'Cancelled' };
  if (status === 'FINALIZED') {
    return {
      kind: 'Finalized',
      value: {
        score: {
          home: Number(match.scoreHome ?? 0),
          away: Number(match.scoreAway ?? 0),
        },
        penalty_winner: normalizePenaltyWinner(match.penaltyWinner),
      },
    };
  }
  if (status === 'PROPOSED') {
    return {
      kind: 'Proposed',
      value: {
        score: {
          home: Number(match.scoreHome ?? 0),
          away: Number(match.scoreAway ?? 0),
        },
        penalty_winner: normalizePenaltyWinner(match.penaltyWinner),
        oracle: '0x',
        proposed_at: '0',
      },
    };
  }
  return { kind: 'Unresolved' };
}

function normalizeIndexerStatus(status: string): 'UNRESOLVED' | 'PROPOSED' | 'FINALIZED' | 'SETTLED' | 'CANCELLED' {
  const normalized = status.trim().toUpperCase();
  if (normalized === 'PROPOSED') return 'PROPOSED';
  if (normalized === 'FINALIZED') return 'FINALIZED';
  if (normalized === 'SETTLED') return 'SETTLED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  return 'UNRESOLVED';
}

function indexerBetToUserBet(bet: IndexerBet): UserBetView {
  return {
    match_id: String(bet.matchId),
    score: {
      home: Number(bet.scoreHome),
      away: Number(bet.scoreAway),
    },
    penalty_winner: normalizePenaltyWinner(bet.penaltyWinner),
    stake_in_match_pool: bet.stakeRaw,
    freebet_principal: '0',
    claimed: false,
  };
}

function normalizePenaltyWinner(value: string | null): PenaltyWinner | null {
  if (value === 'home' || value === 'Home') return 'Home';
  if (value === 'away' || value === 'Away') return 'Away';
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
