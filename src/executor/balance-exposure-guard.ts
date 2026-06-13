import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { usdToPlanck, type VaraUsdPriceSource } from '../economics/vara-usd-converter.js';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import type {
  AgentConfig,
  StoredTransactionPlan,
  TransactionSafetyCheck,
  U128String,
  UserBetView,
} from '../types/index.js';

const execFileAsync = promisify(execFile);

type RawRecord = Record<string, unknown>;

export type BalanceExposureInput = {
  config: AgentConfig;
  plan: StoredTransactionPlan;
  userBets: UserBetView[];
  storedPlans: StoredTransactionPlan[];
};

export type BalanceExposureEvaluation = {
  check: TransactionSafetyCheck;
  blocked: boolean;
};

export async function evaluateBalanceExposure(input: BalanceExposureInput): Promise<BalanceExposureEvaluation> {
  const valuePlanck = parsePlanck(input.plan.valuePlanck, 'plan value');
  const minStake = await resolveMinStakePlanck(input.config);
  const stakeCap = await resolveCapPlanck(input.config, 'stake');
  const exposureCap = await resolveCapPlanck(input.config, 'exposure');
  const minStakePlanck = minStake?.planck ?? null;
  const maxStakePlanck = stakeCap.planck;
  const maxExposurePlanck = exposureCap.planck;

  if (minStake && valuePlanck < minStake.planck) {
    return fail('Planned stake is below the configured SmartCup minimum stake.', input, {
      valuePlanck: valuePlanck.toString(),
      minStakePlanck: minStake.planck.toString(),
      minStakeSource: minStake.source,
      price: minStake.price,
    });
  }

  if (valuePlanck > maxStakePlanck) {
    return fail('Planned stake exceeds configured max-stake cap.', input, {
      valuePlanck: valuePlanck.toString(),
      maxStakePlanck: maxStakePlanck.toString(),
      maxStakeSource: stakeCap.source,
      price: stakeCap.price,
    });
  }

  const currentExposurePlanck = currentChainExposure(input.userBets);
  const locallyPlannedExposurePlanck = localPlannedExposure(input.storedPlans, input.plan.id);
  const projectedExposurePlanck = currentExposurePlanck + locallyPlannedExposurePlanck + valuePlanck;

  if (projectedExposurePlanck > maxExposurePlanck) {
    return fail('Projected tournament exposure exceeds configured max-exposure cap.', input, {
      valuePlanck: valuePlanck.toString(),
      currentExposurePlanck: currentExposurePlanck.toString(),
      locallyPlannedExposurePlanck: locallyPlannedExposurePlanck.toString(),
      projectedExposurePlanck: projectedExposurePlanck.toString(),
      maxTournamentExposurePlanck: maxExposurePlanck.toString(),
      maxTournamentExposureSource: exposureCap.source,
      price: exposureCap.price,
    });
  }

  const balance = await readWalletBalancePlanck(input.config);
  const freePlanck = parsePlanck(balance.freePlanck, 'wallet free balance');

  if (freePlanck < valuePlanck) {
    return fail('Wallet free balance is lower than planned attached value.', input, {
      valuePlanck: valuePlanck.toString(),
      freePlanck: freePlanck.toString(),
      rawBalance: balance.raw,
    });
  }

  return {
    blocked: false,
    check: {
      name: 'balance_and_exposure',
      status: 'pass',
      message: 'Wallet balance, max-stake cap, and tournament exposure cap passed.',
      details: {
        valuePlanck: valuePlanck.toString(),
        freePlanck: freePlanck.toString(),
        minStakePlanck: minStakePlanck?.toString() ?? null,
        minStakeSource: minStake?.source ?? null,
        maxStakePlanck: maxStakePlanck.toString(),
        maxStakeSource: stakeCap.source,
        currentExposurePlanck: currentExposurePlanck.toString(),
        locallyPlannedExposurePlanck: locallyPlannedExposurePlanck.toString(),
        projectedExposurePlanck: projectedExposurePlanck.toString(),
        maxTournamentExposurePlanck: maxExposurePlanck.toString(),
        maxTournamentExposureSource: exposureCap.source,
        price: stakeCap.price ?? exposureCap.price,
        rawBalance: balance.raw,
        note: 'Gas cost is not included until the later gas-estimation execution guard.',
      },
    },
  };
}

async function resolveCapPlanck(
  config: AgentConfig,
  cap: 'stake' | 'exposure',
): Promise<{ planck: bigint; source: string; price: VaraUsdPriceSource | null }> {
  const usd =
    cap === 'stake'
      ? config.policy.maxStakeUsd
      : config.policy.maxTournamentExposureUsd;
  if (usd) {
    const converted = await usdToPlanck(config, usd);
    return {
      planck: BigInt(converted.planck),
      source: cap === 'stake' ? `usd:${usd}` : `usd:${usd}`,
      price: converted.price,
    };
  }

  const planck =
    cap === 'stake'
      ? parsePlanck(config.policy.maxStakePlanck, 'max stake')
      : parsePlanck(config.policy.maxTournamentExposurePlanck, 'max tournament exposure');
  return { planck, source: 'planck_env', price: null };
}

async function resolveMinStakePlanck(
  config: AgentConfig,
): Promise<{ planck: bigint; source: string; price: VaraUsdPriceSource } | null> {
  const usd = config.policy.minStakeUsd;
  if (!usd) return null;
  const converted = await usdToPlanck(config, usd);
  return {
    planck: BigInt(converted.planck),
    source: `usd:${usd}`,
    price: converted.price,
  };
}

async function readWalletBalancePlanck(config: AgentConfig): Promise<{ freePlanck: U128String; raw: unknown }> {
  const args = ['--ws', config.network.rpcUrl, '--json', 'balance', config.wallet.ss58Address];
  const walletBin = varaWalletBin();
  const command = walletBin ?? 'npm';
  const commandArgs = walletBin
    ? args
    : ['exec', '--yes', '--package=vara-wallet', '--', 'vara-wallet', ...args];

  const { stdout } = await execFileAsync(command, commandArgs, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  const raw = firstJson(stdout);
  const freePlanck = readBalancePlanck(raw);
  if (!freePlanck) {
    throw new Error(`Could not parse wallet free balance from vara-wallet output: ${stdout}`);
  }
  return { freePlanck, raw };
}

function fail(
  message: string,
  input: BalanceExposureInput,
  details: Record<string, unknown>,
): BalanceExposureEvaluation {
  return {
    blocked: true,
    check: {
      name: 'balance_and_exposure',
      status: 'fail',
      message,
      details: {
        kind: input.plan.kind,
        wallet: input.config.wallet.hexAddress,
        ...details,
      },
    },
  };
}

function currentChainExposure(userBets: UserBetView[]): bigint {
  return userBets.reduce((sum, bet) => sum + parsePlanck(bet.stake_in_match_pool, 'stake in match pool'), 0n);
}

function localPlannedExposure(plans: StoredTransactionPlan[], currentPlanId: string): bigint {
  return plans.reduce((sum, plan) => {
    if (plan.id === currentPlanId) return sum;
    if (plan.kind !== 'PlaceBet' && plan.kind !== 'SubmitPodiumPick') return sum;
    if (plan.status === 'blocked' || plan.status === 'failed' || plan.status === 'cancelled') return sum;
    return sum + parsePlanck(plan.valuePlanck, 'stored transaction value');
  }, 0n);
}

function parsePlanck(value: string, label: string): bigint {
  if (!isNonNegativePlanck(value)) throw new Error(`Invalid ${label}: ${value}`);
  return BigInt(value);
}

function isNonNegativePlanck(value: string): boolean {
  return /^\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value);
}

function readBalancePlanck(value: unknown): U128String | null {
  const raw = asRecord(value);
  if (!raw) return null;

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
  return null;
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

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null;
}
