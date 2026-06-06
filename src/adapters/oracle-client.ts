import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import type {
  ActorId,
  AgentConfig,
  IoOracleMatchResult,
  IoOracleState,
  OracleFeederSubmission,
  OracleFinalResult,
  OracleResultStatus,
  OracleVaraUsdPrice,
  PenaltyWinner,
  Score,
  U64String,
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

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    home: asNumber(raw.home ?? raw[0]),
    away: asNumber(raw.away ?? raw[1]),
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

function normalizeOracleStatus(value: unknown): OracleResultStatus {
  if (value === 'Pending' || value === 'Finalized') return value;
  if (typeof value === 'object' && value) {
    const raw = value as RawRecord;
    const kind = raw.kind ?? Object.keys(raw)[0];
    if (kind === 'Pending' || kind === 'pending') return 'Pending';
    if (kind === 'Finalized' || kind === 'finalized') return 'Finalized';
  }
  throw new Error(`Unknown OracleResultStatus shape: ${JSON.stringify(value)}`);
}

function normalizeFinalResult(value: unknown): OracleFinalResult {
  const raw = asRecord(value, 'FinalResult');
  return {
    score: normalizeScore(raw.score ?? raw[0]),
    penalty_winner: normalizePenaltyWinner(raw.penalty_winner ?? raw.penaltyWinner ?? raw[1]),
    finalized_at: asString(raw.finalized_at ?? raw.finalizedAt ?? raw[2], '0') as U64String,
  };
}

function normalizeMatchResult(value: unknown): IoOracleMatchResult {
  const raw = asRecord(value, 'IoMatchResult');
  return {
    match_id: asString(raw.match_id ?? raw.matchId ?? raw[0], '0') as U64String,
    phase: asString(raw.phase ?? raw[1], ''),
    home: asString(raw.home ?? raw[2], ''),
    away: asString(raw.away ?? raw[3], ''),
    kick_off: asString(raw.kick_off ?? raw.kickOff ?? raw[4], '0') as U64String,
    status: normalizeOracleStatus(raw.status ?? raw[5]),
    final_result:
      unwrapOption(raw.final_result ?? raw.finalResult ?? raw[6]) === null
        ? null
        : normalizeFinalResult(unwrapOption(raw.final_result ?? raw.finalResult ?? raw[6])),
    submissions: asNumber(raw.submissions ?? raw[7]),
  };
}

function normalizeState(value: unknown): IoOracleState {
  const raw = asRecord(value, 'IoOracleState');
  const authorizedFeeders = raw.authorized_feeders ?? raw.authorizedFeeders;
  const matchResults = raw.match_results ?? raw.matchResults;
  return {
    admin: normalizeActorId(raw.admin),
    admins: Array.isArray(raw.admins) ? raw.admins.map(normalizeActorId) : [],
    operators: Array.isArray(raw.operators) ? raw.operators.map(normalizeActorId) : [],
    consensus_threshold: asNumber(raw.consensus_threshold ?? raw.consensusThreshold),
    bolao_program_id: normalizeOptionalActorId(raw.bolao_program_id ?? raw.bolaoProgramId),
    authorized_feeders: Array.isArray(authorizedFeeders) ? authorizedFeeders.map(normalizeActorId) : [],
    match_results: Array.isArray(matchResults) ? matchResults.map(normalizeMatchResult) : [],
    pending_admin: normalizeOptionalActorId(raw.pending_admin ?? raw.pendingAdmin),
    vara_price_usd_micro: asString(raw.vara_price_usd_micro ?? raw.varaPriceUsdMicro, '0') as U64String,
    price_updated_at: asString(raw.price_updated_at ?? raw.priceUpdatedAt, '0') as U64String,
  };
}

function normalizeOptionalActorId(value: unknown): ActorId | null {
  const unwrapped = unwrapOption(value);
  return unwrapped === null ? null : normalizeActorId(unwrapped);
}

function normalizeFeederSubmission(value: unknown): OracleFeederSubmission {
  if (Array.isArray(value)) {
    return {
      match_id: asString(value[0], '0') as U64String,
      score: normalizeScore(value[1]),
      penalty_winner: normalizePenaltyWinner(value[2]),
    };
  }

  const raw = asRecord(value, 'feeder submission');
  return {
    match_id: asString(raw.match_id ?? raw.matchId ?? raw[0], '0') as U64String,
    score: normalizeScore(raw.score ?? raw[1]),
    penalty_winner: normalizePenaltyWinner(raw.penalty_winner ?? raw.penaltyWinner ?? raw[2]),
  };
}

function normalizeVaraUsdPrice(value: unknown): OracleVaraUsdPrice {
  if (Array.isArray(value)) {
    return {
      price_usd_micro: asString(value[0], '0') as U64String,
      price_updated_at: asString(value[1], '0') as U64String,
    };
  }

  const raw = asRecord(value, 'VARA/USD price');
  return {
    price_usd_micro: asString(raw.price_usd_micro ?? raw.priceUsdMicro ?? raw[0], '0') as U64String,
    price_updated_at: asString(raw.price_updated_at ?? raw.priceUpdatedAt ?? raw[1], '0') as U64String,
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

export class OracleClient {
  constructor(private readonly config: AgentConfig) {}

  async queryState(): Promise<IoOracleState> {
    return normalizeState(await this.query('Service/QueryState', []));
  }

  async queryAllResults(): Promise<IoOracleMatchResult[]> {
    const result = await this.query('Service/QueryAllResults', []);
    return Array.isArray(result) ? result.map(normalizeMatchResult) : [];
  }

  async queryMatchResult(matchId: string | number | bigint): Promise<OracleFinalResult | null> {
    const result = unwrapOption(await this.query('Service/QueryMatchResult', [String(matchId)]));
    return result === null ? null : normalizeFinalResult(result);
  }

  async queryPendingMatches(): Promise<U64String[]> {
    const result = await this.query('Service/QueryPendingMatches', []);
    return Array.isArray(result) ? result.map((matchId) => asString(matchId, '0') as U64String) : [];
  }

  async queryFeederSubmissions(feeder: ActorId): Promise<OracleFeederSubmission[]> {
    const result = await this.query('Service/QueryFeederSubmissions', [feeder]);
    return Array.isArray(result) ? result.map(normalizeFeederSubmission) : [];
  }

  async queryVaraUsdPrice(): Promise<OracleVaraUsdPrice> {
    return normalizeVaraUsdPrice(await this.query('Service/QueryVaraUsdPrice', []));
  }

  async queryContractVersion4(): Promise<number> {
    return asNumber(await this.query('Service/ContractVersion4', []));
  }

  private async query(method: string, args: unknown[]): Promise<unknown> {
    const walletArgs = [
      '--ws',
      this.config.network.rpcUrl,
      '--json',
      'call',
      this.config.programs.oracle,
      method,
      '--args',
      JSON.stringify(args),
      '--idl',
      this.config.artifacts.oracleIdlPath,
    ];

    const walletBin = varaWalletBin();
    const command = walletBin ?? 'npm';
    const commandArgs = walletBin
      ? walletArgs
      : ['exec', '--yes', '--package=vara-wallet', '--', 'vara-wallet', ...walletArgs];

    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });

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
