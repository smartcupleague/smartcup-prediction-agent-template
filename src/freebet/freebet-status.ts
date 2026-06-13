import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { FreebetLedgerClient } from '../adapters/freebet-ledger-client.js';
import { OracleClient } from '../adapters/oracle-client.js';
import type {
  ActorId,
  AgentConfig,
  HexAddress,
  OracleVaraUsdPrice,
  U128String,
  UserBetView,
} from '../types/index.js';
import { resolveFreebetLedgerProgramId, type FreebetLedgerProgramSource } from './freebet-ledger-resolver.js';

export type FreebetStatusReport = {
  checkedAt: string;
  wallet: ActorId;
  bolaoCore: HexAddress;
  freebetLedger: {
    configured: boolean;
    programId: HexAddress | null;
    source: FreebetLedgerProgramSource;
    betProgramAuthorized: boolean | null;
    balancePlanck: U128String | null;
    totalLiabilityPlanck: U128String | null;
    surplusVaraPlanck: U128String | null;
  };
  oracle: {
    programId: HexAddress;
    varaUsdPrice: OracleVaraUsdPrice | null;
  };
  usage: {
    betCount: number;
    freebetPrincipalUsedPlanck: U128String;
    suspiciousFreebetPrincipalCount: number;
    betsWithFreebetPrincipal: Array<{
      matchId: string;
      freebetPrincipalPlanck: U128String;
      claimed: boolean;
      suspicious: boolean;
    }>;
  };
  warnings: string[];
};

export async function buildFreebetStatusReport(
  config: AgentConfig,
  options: { wallet?: ActorId } = {},
): Promise<FreebetStatusReport> {
  const wallet = options.wallet ?? config.wallet.hexAddress;
  const warnings: string[] = [];
  const chain = new BolaoChainClient(config);
  const oracle = new OracleClient(config);

  const configuredLedgerResolution = resolveFreebetLedgerProgramId(config);
  const stateResult = configuredLedgerResolution.programId
    ? null
    : await capture(() => chain.queryState());
  const userBetsResult = await capture(() => chain.queryBetsByUser(wallet));
  const priceResult = await capture(() => oracle.queryVaraUsdPrice());

  if (stateResult && !stateResult.ok) warnings.push(`BolaoCore state read failed: ${stateResult.error}`);
  if (!userBetsResult.ok) warnings.push(`BolaoCore user bet read failed: ${userBetsResult.error}`);
  if (!priceResult.ok) warnings.push(`Oracle VARA/USD price read failed: ${priceResult.error}`);

  const stateLedgerId = stateResult?.ok ? stateResult.value.freebet_ledger_program_id : null;
  const ledgerResolution = configuredLedgerResolution.programId
    ? configuredLedgerResolution
    : resolveFreebetLedgerProgramId(config, {
        bolaoStateLedgerId: stateLedgerId,
      });
  const ledgerProgramId = ledgerResolution.programId;
  const effectiveConfig: AgentConfig = {
    ...config,
    programs: {
      ...config.programs,
      freebetLedger: ledgerProgramId,
    },
  };

  let balancePlanck: U128String | null = null;
  let betProgramAuthorized: boolean | null = null;
  let totalLiabilityPlanck: U128String | null = null;
  let surplusVaraPlanck: U128String | null = null;

  if (ledgerProgramId) {
    const ledger = new FreebetLedgerClient(effectiveConfig);
    const balanceResult = await capture(() => ledger.balanceOf(wallet));
    const authorizedResult = await capture(() => ledger.isBetProgramAuthorized(config.programs.bolaoCore));
    const liabilityResult = await capture(() => ledger.totalLiability());
    const surplusResult = await capture(() => ledger.surplusVara());

    if (balanceResult.ok) balancePlanck = balanceResult.value;
    else warnings.push(`Freebet balance read failed: ${balanceResult.error}`);

    if (authorizedResult.ok) betProgramAuthorized = authorizedResult.value;
    else warnings.push(`Freebet authorization read failed: ${authorizedResult.error}`);

    if (liabilityResult.ok) totalLiabilityPlanck = liabilityResult.value;
    else warnings.push(`Freebet total liability read failed: ${liabilityResult.error}`);

    if (surplusResult.ok) surplusVaraPlanck = surplusResult.value;
    else warnings.push(`Freebet surplus read failed: ${surplusResult.error}`);
  } else {
    warnings.push(
      'Freebet Ledger program ID is not configured and was not discoverable from BolaoCore state or the tournament profile.',
    );
  }

  const bets = userBetsResult.ok ? userBetsResult.value : [];
  const betsWithFreebetPrincipal = bets
    .filter((bet) => BigInt(bet.freebet_principal || '0') > 0n)
    .map((bet) => ({
      matchId: bet.match_id,
      freebetPrincipalPlanck: bet.freebet_principal,
      claimed: bet.claimed,
      suspicious: isSuspiciousFreebetPrincipal(bet.freebet_principal, bet.stake_in_match_pool),
    }));

  const suspiciousFreebetPrincipalCount = betsWithFreebetPrincipal.filter((bet) => bet.suspicious).length;
  if (suspiciousFreebetPrincipalCount > 0) {
    warnings.push(
      `Ignored ${suspiciousFreebetPrincipalCount} suspicious freebet_principal value(s) that were implausibly large relative to visible stake_in_match_pool.`,
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    wallet,
    bolaoCore: config.programs.bolaoCore,
    freebetLedger: {
      configured: Boolean(ledgerProgramId),
      programId: ledgerProgramId,
      source: ledgerResolution.source,
      betProgramAuthorized,
      balancePlanck,
      totalLiabilityPlanck,
      surplusVaraPlanck,
    },
    oracle: {
      programId: config.programs.oracle,
      varaUsdPrice: priceResult.ok ? priceResult.value : null,
    },
    usage: {
      betCount: bets.length,
      freebetPrincipalUsedPlanck: sumFreebetPrincipal(bets),
      suspiciousFreebetPrincipalCount,
      betsWithFreebetPrincipal,
    },
    warnings,
  };
}

export function renderFreebetStatusSummary(report: FreebetStatusReport): string {
  const price = report.oracle.varaUsdPrice;
  return [
    `Wallet: ${report.wallet}`,
    `Freebet Ledger: ${report.freebetLedger.programId ?? 'not configured'} (${report.freebetLedger.source})`,
    `BolaoCore authorized: ${formatNullableBoolean(report.freebetLedger.betProgramAuthorized)}`,
    `Freebet balance: ${formatPlanck(report.freebetLedger.balancePlanck)}`,
    `Freebet principal already used: ${report.usage.freebetPrincipalUsedPlanck} planck`,
    `Bets using freebet principal: ${report.usage.betsWithFreebetPrincipal.length}/${report.usage.betCount} (suspicious ${report.usage.suspiciousFreebetPrincipalCount})`,
    `Ledger total liability: ${formatPlanck(report.freebetLedger.totalLiabilityPlanck)}`,
    `Ledger surplus VARA: ${formatPlanck(report.freebetLedger.surplusVaraPlanck)}`,
    price
      ? `Oracle VARA/USD: ${price.price_usd_micro} micro-USD updated_at ${price.price_updated_at}`
      : 'Oracle VARA/USD: unavailable',
    report.warnings.length ? `Warnings: ${report.warnings.join(' | ')}` : 'Warnings: none',
  ].join('\n');
}

async function capture<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function sumFreebetPrincipal(bets: UserBetView[]): U128String {
  return bets
    .reduce((total, bet) => {
      if (isSuspiciousFreebetPrincipal(bet.freebet_principal, bet.stake_in_match_pool)) return total;
      return total + BigInt(bet.freebet_principal || '0');
    }, 0n)
    .toString() as U128String;
}

function isSuspiciousFreebetPrincipal(freebetPrincipal: U128String, stakeInMatchPool: U128String): boolean {
  const principal = BigInt(freebetPrincipal || '0');
  if (principal <= 0n) return false;

  const visibleStake = BigInt(stakeInMatchPool || '0');
  if (visibleStake <= 0n) return principal > 10_000_000_000_000_000_000n;

  return principal > visibleStake * 100n;
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) return 'unknown';
  return value ? 'yes' : 'no';
}

function formatPlanck(value: U128String | null): string {
  return value === null ? 'unknown' : `${value} planck`;
}
