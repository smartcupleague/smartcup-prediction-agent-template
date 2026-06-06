import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import type { ActorId, AgentConfig, FreebetGrant, HexAddress, U128String, U64String } from '../types/index.js';

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

function normalizeGrant(value: unknown): FreebetGrant {
  const raw = asRecord(value, 'FreebetGrant');
  return {
    id: asString(raw.id, ''),
    recipient: normalizeActorId(raw.recipient),
    amount: asString(raw.amount, '0') as U128String,
    reason: asString(raw.reason, ''),
    granted_at: asString(raw.granted_at ?? raw.grantedAt, '0') as U64String,
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

export class FreebetLedgerClient {
  constructor(private readonly config: AgentConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.programs.freebetLedger);
  }

  getProgramId(): HexAddress {
    if (!this.config.programs.freebetLedger) {
      throw new Error('Freebet Ledger is not configured. Set SMARTCUP_FREEBET_LEDGER_ID before querying it.');
    }
    return this.config.programs.freebetLedger;
  }

  async balanceOf(user: ActorId): Promise<U128String> {
    return asString(await this.query('FreebetLedger/BalanceOf', [user]), '0') as U128String;
  }

  async isBetProgramAuthorized(programId: ActorId): Promise<boolean> {
    return asBoolean(await this.query('FreebetLedger/IsBetProgramAuthorized', [programId]));
  }

  async getGrant(grantId: string): Promise<FreebetGrant | null> {
    const result = unwrapOption(await this.query('FreebetLedger/GetGrant', [grantId]));
    return result === null ? null : normalizeGrant(result);
  }

  async surplusVara(): Promise<U128String> {
    return asString(await this.query('FreebetLedger/SurplusVara', []), '0') as U128String;
  }

  async totalLiability(): Promise<U128String> {
    return asString(await this.query('FreebetLedger/TotalLiability', []), '0') as U128String;
  }

  private async query(method: string, args: unknown[]): Promise<unknown> {
    const walletArgs = [
      '--ws',
      this.config.network.rpcUrl,
      '--json',
      'call',
      this.getProgramId(),
      method,
      '--args',
      JSON.stringify(args),
      '--idl',
      this.config.artifacts.freebetLedgerIdlPath,
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
