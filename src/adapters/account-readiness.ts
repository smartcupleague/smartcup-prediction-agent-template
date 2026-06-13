import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BolaoChainClient } from './bolao-chain-client.js';
import { SmartCupApiAdapter } from './smartcup-api-adapter.js';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import type {
  AccountReadinessCheck,
  AccountReadinessReport,
  ActorId,
  AgentConfig,
  SmartCupApiWalletProfile,
  U128String,
  UserBetView,
} from '../types/index.js';

const execFileAsync = promisify(execFile);

type RawRecord = Record<string, unknown>;

function ok(message: string, details?: Record<string, unknown>): AccountReadinessCheck {
  return details ? { status: 'ok', message, details } : { status: 'ok', message };
}

function warning(message: string, details?: Record<string, unknown>): AccountReadinessCheck {
  return details ? { status: 'warning', message, details } : { status: 'warning', message };
}

function errorCheck(message: string, details?: Record<string, unknown>): AccountReadinessCheck {
  return details ? { status: 'error', message, details } : { status: 'error', message };
}

function unknown(message: string, details?: Record<string, unknown>): AccountReadinessCheck {
  return details ? { status: 'unknown', message, details } : { status: 'unknown', message };
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null;
}

function firstJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf('{');
    const firstArray = trimmed.indexOf('[');
    const first =
      firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
    const last = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (first < 0 || last < first) return trimmed;
    return JSON.parse(trimmed.slice(first, last + 1));
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function readBalancePlanck(value: unknown): U128String | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;

  const candidates = [
    raw.freePlanck,
    raw.free_planck,
    raw.transferablePlanck,
    raw.transferable_planck,
    raw.availablePlanck,
    raw.available_planck,
    raw.balancePlanck,
    raw.balance_planck,
    raw.balanceRaw,
    raw.balance_raw,
    raw.free,
    raw.transferable,
    raw.balance,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    return String(candidate) as U128String;
  }
  return undefined;
}

function profileCheck(profile: SmartCupApiWalletProfile | null): AccountReadinessReport['smartcup']['profile'] {
  if (!profile) {
    return {
      ...warning('SmartCup API profile was not found or could not be loaded.'),
      displayName: null,
    };
  }
  if (!profile.display_name) {
    return {
      ...warning('Wallet profile exists but has no display name set.'),
      displayName: null,
      updatedAt: profile.updated_at ?? null,
    };
  }
  return {
    ...ok('SmartCup API profile is available.'),
    displayName: profile.display_name,
    updatedAt: profile.updated_at ?? null,
  };
}

export class AccountReadinessAdapter {
  private readonly chain: BolaoChainClient;
  private readonly smartcupApi: SmartCupApiAdapter;

  constructor(
    private readonly config: AgentConfig,
    deps?: {
      chain?: BolaoChainClient;
      smartcupApi?: SmartCupApiAdapter;
    },
  ) {
    this.chain = deps?.chain ?? new BolaoChainClient(config);
    this.smartcupApi = deps?.smartcupApi ?? new SmartCupApiAdapter(config.services.smartcupApiUrl);
  }

  async check(): Promise<AccountReadinessReport> {
    const wallet = this.config.wallet.hexAddress;
    const localWallet = await this.checkLocalWallet();
    const balance = await this.checkBalance();
    const profile = await this.checkProfile();
    const currentPredictions = await this.checkCurrentPredictions(wallet);
    const points = await this.checkPoints(wallet);

    const terms = this.checkTerms(wallet);
    const readyForReadOnly =
      localWallet.status !== 'error' && currentPredictions.status !== 'error' && points.status !== 'error';

    return {
      generatedAt: new Date().toISOString(),
      wallet: {
        accountName: this.config.wallet.accountName,
        configuredHex: wallet,
        configuredSs58: this.config.wallet.ss58Address,
        localWallet,
        balance,
      },
      smartcup: {
        terms,
        profile,
        currentPredictions,
        points,
      },
      readyForReadOnly,
      readyForAutonomousWrites: false,
    };
  }

  private checkTerms(wallet: ActorId): AccountReadinessReport['smartcup']['terms'] {
    const localStorageKey = `scl_terms_v2:${wallet}`;
    return {
      ...unknown('Terms acceptance is stored in SmartCup frontend localStorage and cannot be verified by this Node process.'),
      localStorageKey,
    };
  }

  private async checkLocalWallet(): Promise<AccountReadinessCheck> {
    try {
      const output = await this.varaWallet(['--json', 'wallet', 'list'], 20_000);
      const wallets = Array.isArray(output) ? output : asRecord(output)?.wallets;
      if (!Array.isArray(wallets)) {
        return unknown('Could not parse vara-wallet wallet list.', { raw: output });
      }

      const found = wallets.some((entry) => {
        const raw = asRecord(entry);
        if (!raw) return false;
        return (
          raw.name === this.config.wallet.accountName ||
          raw.address === this.config.wallet.ss58Address ||
          raw.hexAddress === this.config.wallet.hexAddress ||
          raw.hex_address === this.config.wallet.hexAddress
        );
      });

      return found
        ? ok('Local vara-wallet account is present.', { accountName: this.config.wallet.accountName })
        : errorCheck('Configured vara-wallet account was not found locally.', {
            accountName: this.config.wallet.accountName,
          });
    } catch (reason) {
      return errorCheck('Could not list local vara-wallet accounts.', { error: errorMessage(reason) });
    }
  }

  private async checkBalance(): Promise<AccountReadinessReport['wallet']['balance']> {
    try {
      const output = await this.varaWallet(
        [
          '--ws',
          this.config.network.rpcUrl,
          '--json',
          'balance',
          this.config.wallet.ss58Address,
        ],
        30_000,
      );
      const freePlanck = readBalancePlanck(output);
      const result: AccountReadinessReport['wallet']['balance'] = {
        ...ok('Wallet balance query succeeded.'),
        raw: output,
      };
      if (freePlanck !== undefined) result.freePlanck = freePlanck;
      return {
        ...result,
      };
    } catch (reason) {
      return {
        ...errorCheck('Could not query wallet balance.', { error: errorMessage(reason) }),
        raw: null,
      };
    }
  }

  private async checkProfile(): Promise<AccountReadinessReport['smartcup']['profile']> {
    try {
      return profileCheck(await this.smartcupApi.getProfile(this.config.wallet.hexAddress));
    } catch (reason) {
      return {
        ...warning('Could not read SmartCup API profile.'),
        details: { error: errorMessage(reason) },
        displayName: null,
      };
    }
  }

  private async checkCurrentPredictions(
    wallet: ActorId,
  ): Promise<AccountReadinessReport['smartcup']['currentPredictions']> {
    try {
      const bets = await this.chain.queryBetsByUser(wallet);
      return {
        ...(bets.length > 0
          ? ok(`Found ${bets.length} current SmartCup prediction(s).`)
          : warning('No current SmartCup predictions were found for this wallet.')),
        bets,
      };
    } catch (reason) {
      return {
        ...errorCheck('Could not query current SmartCup predictions.', { error: errorMessage(reason) }),
        bets: [] as UserBetView[],
      };
    }
  }

  private async checkPoints(wallet: ActorId): Promise<AccountReadinessReport['smartcup']['points']> {
    try {
      const value = await this.chain.queryUserPoints(wallet);
      return {
        ...ok('SmartCup user points query succeeded.'),
        value,
      };
    } catch (reason) {
      return {
        ...errorCheck('Could not query SmartCup user points.', { error: errorMessage(reason) }),
      };
    }
  }

  private async varaWallet(args: string[], timeout: number): Promise<unknown> {
    const walletBin = varaWalletBin();
    const command = walletBin ?? 'npm';
    const commandArgs = walletBin
      ? args
      : ['exec', '--yes', '--package=vara-wallet', '--', 'vara-wallet', ...args];

    const { stdout } = await execFileAsync(command, commandArgs, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    return firstJson(stdout);
  }
}
