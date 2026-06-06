import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import type {
  ActorId,
  AgentConfig,
  BolaoMatch,
  FinalPrizeClaimStatus,
  IoSmartCupState,
  PenaltyWinner,
  ResultStatus,
  Score,
  U128String,
  U64String,
  UserBetView,
  WalletClaimStatus,
} from '../types/index.js';

const execFileAsync = promisify(execFile);

type VaraWalletEnvelope<T> = {
  result?: T;
  error?: unknown;
  code?: string;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value as RawRecord;
}

function asString(value: unknown, fallback = '0'): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function unwrapOption(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const raw = value as RawRecord;
  if ('Some' in raw) return raw.Some;
  if ('some' in raw) return raw.some;
  if ('None' in raw || 'none' in raw) return null;
  if (raw.kind === 'Some') return raw.value ?? null;
  if (raw.kind === 'None') return null;
  return value;
}

function normalizeActorId(value: unknown): ActorId {
  return asString(value, '0x') as ActorId;
}

function normalizeScore(value: unknown): Score {
  const raw = asRecord(value, 'Score');
  return {
    home: asNumber(raw.home),
    away: asNumber(raw.away),
  };
}

function normalizePenaltyWinner(value: unknown): PenaltyWinner | null {
  const unwrapped = unwrapOption(value);
  if (unwrapped !== value) return normalizePenaltyWinner(unwrapped);

  if (value === null || value === undefined) return null;
  if (value === 'Home' || value === 'Away') return value;
  if (typeof value === 'object' && value && 'kind' in value) {
    const kind = (value as { kind?: unknown }).kind;
    if (kind === 'Home' || kind === 'Away') return kind;
  }
  if (typeof value === 'object' && value) {
    const key = Object.keys(value)[0];
    if (key === 'Home' || key === 'Away') return key;
  }
  throw new Error(`Unknown PenaltyWinner shape: ${JSON.stringify(value)}`);
}

function normalizeResultStatus(value: unknown): ResultStatus {
  if (value === 'Unresolved') return { kind: 'Unresolved' };
  if (value === 'Cancelled') return { kind: 'Cancelled' };

  const raw = asRecord(value, 'ResultStatus');
  const kind = raw.kind ?? Object.keys(raw)[0];

  if (kind === 'Unresolved' || kind === 'unresolved') return { kind: 'Unresolved' };
  if (kind === 'Cancelled' || kind === 'cancelled') return { kind: 'Cancelled' };

  if (kind === 'Proposed' || kind === 'proposed') {
    const payload = asRecord(raw.value ?? raw.Proposed ?? raw.proposed, 'ResultStatus.Proposed');
    return {
      kind: 'Proposed',
      value: {
        score: normalizeScore(payload.score),
        penalty_winner: normalizePenaltyWinner(payload.penalty_winner ?? payload.penaltyWinner),
        oracle: normalizeActorId(payload.oracle),
        proposed_at: asString(payload.proposed_at) as U64String,
      },
    };
  }

  if (kind === 'Finalized' || kind === 'finalized') {
    const payload = asRecord(raw.value ?? raw.Finalized ?? raw.finalized, 'ResultStatus.Finalized');
    return {
      kind: 'Finalized',
      value: {
        score: normalizeScore(payload.score),
        penalty_winner: normalizePenaltyWinner(payload.penalty_winner ?? payload.penaltyWinner),
      },
    };
  }

  throw new Error(`Unknown ResultStatus shape: ${JSON.stringify(value)}`);
}

function normalizeMatch(value: unknown): BolaoMatch {
  const raw = asRecord(value, 'Match');
  return {
    match_id: asString(raw.match_id ?? raw.matchId) as U64String,
    phase: asString(raw.phase, ''),
    home: asString(raw.home, ''),
    away: asString(raw.away, ''),
    kick_off: asString(raw.kick_off ?? raw.kickOff) as U64String,
    result: normalizeResultStatus(raw.result),
    match_prize_pool: asString(raw.match_prize_pool ?? raw.matchPrizePool) as U128String,
    has_bets: asBoolean(raw.has_bets ?? raw.hasBets),
    participants: Array.isArray(raw.participants) ? raw.participants.map(normalizeActorId) : [],
    total_winner_stake: asString(raw.total_winner_stake ?? raw.totalWinnerStake) as U128String,
    total_claimed: asString(raw.total_claimed ?? raw.totalClaimed) as U128String,
    settlement_prepared: asBoolean(raw.settlement_prepared ?? raw.settlementPrepared),
    dust_swept: asBoolean(raw.dust_swept ?? raw.dustSwept),
    finalized_at: asNullableString(unwrapOption(raw.finalized_at ?? raw.finalizedAt)) as U64String | null,
  };
}

function normalizeUserBetView(value: unknown): UserBetView {
  const raw = asRecord(value, 'UserBetView');
  return {
    match_id: asString(raw.match_id ?? raw.matchId) as U64String,
    score: normalizeScore(raw.score),
    penalty_winner: normalizePenaltyWinner(raw.penalty_winner ?? raw.penaltyWinner),
    stake_in_match_pool: asString(raw.stake_in_match_pool ?? raw.stakeInMatchPool) as U128String,
    freebet_principal: asString(raw.freebet_principal ?? raw.freebetPrincipal, '0') as U128String,
    claimed: asBoolean(raw.claimed),
  };
}

function normalizeWalletClaimStatus(value: unknown): WalletClaimStatus {
  const raw = asRecord(value, 'WalletClaimStatus');
  return {
    wallet: normalizeActorId(raw.wallet),
    amount_claimable: asString(raw.amount_claimable ?? raw.amountClaimable) as U128String,
    already_claimed: asBoolean(raw.already_claimed ?? raw.alreadyClaimed),
  };
}

function normalizeFinalPrizeClaimStatus(value: unknown): FinalPrizeClaimStatus {
  const raw = asRecord(value, 'FinalPrizeClaimStatus');
  return {
    wallet: normalizeActorId(raw.wallet),
    final_prize_finalized: asBoolean(raw.final_prize_finalized ?? raw.finalPrizeFinalized),
    eligible: asBoolean(raw.eligible),
    amount_claimable: asString(raw.amount_claimable ?? raw.amountClaimable) as U128String,
    already_claimed: asBoolean(raw.already_claimed ?? raw.alreadyClaimed),
    points: asNumber(raw.points),
  };
}

function normalizeUserPoints(value: unknown): { actor_id: ActorId; points: number } {
  if (Array.isArray(value)) {
    return { actor_id: normalizeActorId(value[0]), points: asNumber(value[1]) };
  }

  const raw = asRecord(value, 'user_points entry');
  return {
    actor_id: normalizeActorId(raw.actor_id ?? raw.actorId ?? raw[0]),
    points: asNumber(raw.points ?? raw[1]),
  };
}

function normalizeState(value: unknown): IoSmartCupState {
  const raw = asRecord(value, 'IoSmartCupState');
  const userPointsRaw = raw.user_points ?? raw.userPoints;

  return {
    admins: Array.isArray(raw.admins) ? raw.admins.map(normalizeActorId) : [],
    operators: Array.isArray(raw.operators) ? raw.operators.map(normalizeActorId) : [],
    treasury: normalizeActorId(raw.treasury),
    protocol_fee_accumulated: asString(raw.protocol_fee_accumulated ?? raw.protocolFeeAccumulated) as U128String,
    final_prize_accumulated: asString(raw.final_prize_accumulated ?? raw.finalPrizeAccumulated) as U128String,
    matches: Array.isArray(raw.matches) ? raw.matches.map(normalizeMatch) : [],
    phases: Array.isArray(raw.phases)
      ? raw.phases.map((phase) => {
          const p = asRecord(phase, 'PhaseConfig');
          return {
            name: asString(p.name, ''),
            start_time: asString(p.start_time ?? p.startTime) as U64String,
            end_time: asString(p.end_time ?? p.endTime) as U64String,
            points_weight: asNumber(p.points_weight ?? p.pointsWeight),
          };
        })
      : [],
    user_points: Array.isArray(userPointsRaw) ? userPointsRaw.map(normalizeUserPoints) : [],
    podium_finalized: asBoolean(raw.podium_finalized ?? raw.podiumFinalized),
    r32_lock_time: asNullableString(unwrapOption(raw.r32_lock_time ?? raw.r32LockTime)) as U64String | null,
    final_prize_finalized: asBoolean(raw.final_prize_finalized ?? raw.finalPrizeFinalized),
    final_prize_claimable_total: asString(raw.final_prize_claimable_total ?? raw.finalPrizeClaimableTotal) as U128String,
    final_prize_rounding_dust: asString(raw.final_prize_rounding_dust ?? raw.finalPrizeRoundingDust) as U128String,
    vara_price_usd_micro: asString(raw.vara_price_usd_micro ?? raw.varaPriceUsdMicro, '0') as U64String,
    price_cached_at: asString(raw.price_cached_at ?? raw.priceCachedAt, '0') as U64String,
    price_staleness_limit_ms: asString(
      raw.price_staleness_limit_ms ?? raw.priceStalenessLimitMs,
      '0',
    ) as U64String,
    freebet_ledger_program_id: asNullableString(
      unwrapOption(raw.freebet_ledger_program_id ?? raw.freebetLedgerProgramId),
    ) as ActorId | null,
  };
}

function extractJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last < first) {
    throw new Error(`vara-wallet did not return JSON: ${stdout}`);
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

export class BolaoChainClient {
  constructor(private readonly config: AgentConfig) {}

  async queryState(): Promise<IoSmartCupState> {
    return normalizeState(await this.query('Service/QueryState', []));
  }

  async queryMatch(matchId: string | number | bigint): Promise<BolaoMatch | null> {
    const result = unwrapOption(await this.query('Service/QueryMatch', [String(matchId)]));
    return result === null ? null : normalizeMatch(result);
  }

  async queryBetsByUser(user: ActorId): Promise<UserBetView[]> {
    const result = await this.query('Service/QueryBetsByUser', [user]);
    return Array.isArray(result) ? result.map(normalizeUserBetView) : [];
  }

  async queryUserPoints(user: ActorId): Promise<number> {
    return asNumber(await this.query('Service/QueryUserPoints', [user]));
  }

  async queryContractVersion4(): Promise<number> {
    return asNumber(await this.query('Service/ContractVersion4', []));
  }

  async queryWalletClaimStatus(wallet: ActorId): Promise<WalletClaimStatus> {
    return normalizeWalletClaimStatus(await this.query('Service/QueryWalletClaimStatus', [wallet]));
  }

  async queryFinalPrizeClaimStatus(wallet: ActorId): Promise<FinalPrizeClaimStatus> {
    return normalizeFinalPrizeClaimStatus(await this.query('Service/QueryFinalPrizeClaimStatus', [wallet]));
  }

  async queryPendingRefund(wallet: ActorId): Promise<U128String> {
    return asString(await this.query('Service/QueryPendingRefund', [wallet])) as U128String;
  }

  private async query(method: string, args: unknown[]): Promise<unknown> {
    const walletArgs = [
      '--ws',
      this.config.network.rpcUrl,
      '--json',
      'call',
      this.config.programs.bolaoCore,
      method,
      '--args',
      JSON.stringify(args),
      '--idl',
      this.config.artifacts.bolaoIdlPath,
    ];

    const walletBin = varaWalletBin();
    const command = walletBin ?? 'npm';
    const commandArgs = walletBin
      ? walletArgs
      : ['exec', '--yes', '--package=vara-wallet', '--', 'vara-wallet', ...walletArgs];

    const { stdout, stderr } = await runVaraWalletQuery(command, commandArgs, method);

    const envelope = extractJson(stdout) as VaraWalletEnvelope<unknown>;
    if (envelope.error || envelope.code) {
      throw new Error(`vara-wallet ${method} failed: ${JSON.stringify(envelope)}`);
    }
    if (!('result' in envelope)) {
      throw new Error(`vara-wallet ${method} returned no result. stderr=${stderr}`);
    }
    return envelope.result;
  }
}

async function runVaraWalletQuery(
  command: string,
  commandArgs: string[],
  method: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error(`vara-wallet ${method} command failed: ${formatExecError(error)}`, { cause: error });
  }
}

function formatExecError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const raw = error as {
    message?: unknown;
    code?: unknown;
    signal?: unknown;
    killed?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  return [
    raw.message ? `message=${String(raw.message)}` : null,
    raw.code ? `code=${String(raw.code)}` : null,
    raw.signal ? `signal=${String(raw.signal)}` : null,
    raw.killed !== undefined ? `killed=${String(raw.killed)}` : null,
    raw.stderr ? `stderr=${String(raw.stderr).slice(0, 1_000)}` : null,
    raw.stdout ? `stdout=${String(raw.stdout).slice(0, 1_000)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
}
