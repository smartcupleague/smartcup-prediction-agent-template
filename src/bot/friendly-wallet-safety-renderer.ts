import { evaluateAutopilotReadiness } from '../executor/autopilot-readiness.js';
import type { FreebetStatusReport } from '../freebet/freebet-status.js';
import { MemoryStore } from '../memory/memory-store.js';
import type { PolicySwitchResult } from './policy-control.js';
import type { RefundStatusReport } from '../refund/refund-status.js';
import type { AgentConfig, ExecutionMode, HexAddress } from '../types/index.js';
import { formatFriendlyPlanckAmount } from './friendly-money.js';
import { formatVaraUsdPrice, type VaraUsdPriceSource } from '../economics/vara-usd-converter.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyFreebetStatus(report: FreebetStatusReport): string {
  const price = freebetOraclePrice(report);
  const balance = report.freebetLedger.balancePlanck;
  const authorized = report.freebetLedger.betProgramAuthorized;
  const hasBalance = isPositivePlanck(balance);
  const availableLine =
    report.freebetLedger.configured && authorized === true && hasBalance
      ? 'Freebet mode is available for this wallet, subject to the normal match guards.'
      : report.freebetLedger.configured && authorized === false
        ? 'Freebet mode should stay off: this BolaoCore is not authorized by the ledger.'
        : report.freebetLedger.configured
          ? 'Freebet mode is not available yet for this wallet, or the ledger read was incomplete.'
          : 'Freebet mode is not configured yet. Add the Freebet Ledger ID before using freebet funding.';

  return [
    'Freebet Status',
    '',
    `Wallet checked: ${shortAddress(report.wallet)}`,
    `Freebet Ledger: ${report.freebetLedger.programId ? shortAddress(report.freebetLedger.programId) : 'not configured'} (${report.freebetLedger.source})`,
    `BolaoCore authorization: ${formatAuthorization(authorized)}`,
    '',
    'Available balance:',
    `- ${formatMaybePlanck(balance, price)}`,
    '',
    'Usage already seen:',
    `- Freebet principal used: ${formatFriendlyPlanckAmount(report.usage.freebetPrincipalUsedPlanck, price)}`,
    `- Bets using freebet principal: ${report.usage.betsWithFreebetPrincipal.length} of ${report.usage.betCount}`,
    report.usage.suspiciousFreebetPrincipalCount > 0
      ? `- Suspicious historical principal values ignored: ${report.usage.suspiciousFreebetPrincipalCount}`
      : '- Suspicious historical principal values ignored: none',
    '',
    'Ledger health:',
    `- Total liability: ${formatMaybePlanck(report.freebetLedger.totalLiabilityPlanck, price)}`,
    `- Surplus VARA: ${formatMaybePlanck(report.freebetLedger.surplusVaraPlanck, price)}`,
    price ? `- VARA/USD price: ${formatVaraUsdPrice(price)}${price.updatedAt ? `, updated ${price.updatedAt}` : ''}` : '- VARA/USD price: unavailable',
    '',
    `What this means: ${availableLine}`,
    renderWarningBlock(report.warnings),
  ].join('\n');
}

export function renderFriendlyRefundStatus(report: RefundStatusReport): string {
  const matchReward = report.matchRewardClaimStatus;
  const finalPrize = report.finalPrizeClaimStatus;
  const refundRecovery = report.pendingRefundPlanck;
  const hasMatchReward = isPositivePlanck(matchReward?.amount_claimable ?? null);
  const hasFinalPrize = isPositivePlanck(finalPrize?.amount_claimable ?? null);
  const hasRefundRecovery = isPositivePlanck(refundRecovery);
  const openBets = report.cancelledMatchBets.filter((bet) => !bet.claimed);
  const hasAnythingClaimable = hasMatchReward || hasFinalPrize || hasRefundRecovery;

  return [
    'Claim Status',
    '',
    `Wallet checked: ${shortAddress(report.wallet)}`,
    `BolaoCore: ${shortAddress(report.bolaoCore)}`,
    '',
    'Match rewards:',
    `- Claimable now: ${formatMaybePlanck(matchReward?.amount_claimable ?? null, null)}`,
    `- Already claimed: ${formatYesNo(matchReward?.already_claimed)}`,
    '- What this means: match rewards are per-match payouts from finalized SmartCup matches.',
    '',
    'Final prize pool:',
    `- Finalized: ${formatYesNo(finalPrize?.final_prize_finalized)}`,
    `- Eligible: ${formatYesNo(finalPrize?.eligible)}`,
    `- Claimable now: ${formatMaybePlanck(finalPrize?.amount_claimable ?? null, null)}`,
    `- Already claimed: ${formatYesNo(finalPrize?.already_claimed)}`,
    finalPrize?.points !== undefined ? `- Points used for final prize status: ${finalPrize.points}` : '- Points used for final prize status: unknown',
    '',
    'Refund recovery:',
    `- Claimable now: ${formatMaybePlanck(refundRecovery, null)}`,
    '- What this means: this only applies if a match is cancelled after a wallet already entered that match.',
    openBets.length
      ? `- Unclaimed cancelled-match entries found: ${openBets
          .slice(0, 5)
          .map((bet) => `match ${bet.matchId}`)
          .join(', ')}`
      : '- Unclaimed cancelled-match entries found: none',
    '',
    hasAnythingClaimable
      ? 'Next action: review the claimable category, then use the guarded approval flow before any claim transaction is submitted.'
      : 'Next action: nothing appears claimable right now. Check again after match results are finalized or final-prize settlement is complete.',
    renderWarningBlock(report.warnings),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function renderFriendlyExposureStakeLimits(
  config: AgentConfig,
  storedOpenPlanExposurePlanck: string,
): string {
  return [
    'Exposure / Stake Limits',
    '',
    `Connected account: ${config.wallet.accountName}`,
    `Wallet: ${shortAddress(config.wallet.hexAddress)}`,
    `Policy mode: ${policyTitle(config.policy.mode)}`,
    '',
    'Stake guardrails:',
    `- Minimum stake: ${config.policy.minStakeUsd ? `$${config.policy.minStakeUsd} USD` : 'not configured'}`,
    `- Maximum stake: ${formatUsdOrPlanckLimit(config.policy.maxStakeUsd, config.policy.maxStakePlanck)}`,
    `- Maximum tournament exposure: ${formatUsdOrPlanckLimit(
      config.policy.maxTournamentExposureUsd,
      config.policy.maxTournamentExposurePlanck,
    )}`,
    '',
    'Local open exposure memory:',
    `- Planned but not confirmed value exposure: ${formatFriendlyPlanckAmount(storedOpenPlanExposurePlanck, null)}`,
    '',
    'What this means: before any live transaction, the agent still checks duplicate predictions, cutoff buffer, wallet balance, stake cap, tournament exposure, and operator policy.',
  ].join('\n');
}

export function renderFriendlyDataProviderStatus(config: AgentConfig): string {
  return [
    'Data Provider Status',
    '',
    'Core SmartCup reads:',
    `- SmartCup API: ${config.services.smartcupApiUrl}`,
    `- Indexer GraphQL: ${config.services.indexerGraphqlUrl}`,
    `- Indexer timeout: ${config.services.indexerGraphqlTimeoutMs} ms`,
    '',
    'Football fixtures/results:',
    `- Provider: ${config.services.fixtureProvider}`,
    `- API base URL: ${config.services.footballDataBaseUrl}`,
    `- API token: ${config.services.footballDataApiToken ? 'configured' : 'not configured'}`,
    '',
    'Analysis context:',
    `- Odds provider: ${config.services.oddsProvider}`,
    `- Manual odds JSON: ${config.services.manualOddsJson ? 'configured' : 'not configured'}`,
    `- Lineup/injury/news provider: ${config.services.footballContextProvider}`,
    `- Manual football context JSON: ${config.services.manualFootballContextJson ? 'configured' : 'not configured'}`,
    '',
    'Chain reads:',
    `- Network: ${config.network.name}`,
    `- RPC URL: ${config.network.rpcUrl}`,
    `- BolaoCore: ${shortAddress(config.programs.bolaoCore)}`,
    `- Oracle: ${shortAddress(config.programs.oracle)}`,
    `- Freebet Ledger: ${config.programs.freebetLedger ? shortAddress(config.programs.freebetLedger) : 'not configured'}`,
    '',
    'What this means: stronger provider coverage improves confidence labels, timing strategy, and competitor-aware analysis. This status never exposes API tokens or wallet secrets.',
  ].join('\n');
}

export function renderFriendlyOperatorPolicyStatus(config: AgentConfig): string {
  const readiness = evaluateAutopilotReadiness(config);
  const storedPolicy = new MemoryStore().getRuntimePolicy();

  return [
    'Operator Policy',
    '',
    `Current mode: ${policyTitle(config.policy.mode)}`,
    storedPolicy
      ? `Stored runtime override: ${policyTitle(storedPolicy.mode)} (${storedPolicy.source}, updated ${storedPolicy.updatedAt})`
      : 'Stored runtime override: none; using startup environment/default value.',
    '',
    'What each mode allows:',
    ...policyModeLines(),
    '',
    'Autopilot readiness:',
    `- Approval flow verified: ${formatYesNo(config.policy.approvalFlowVerified)}`,
    `- Live smoke verified: ${formatYesNo(config.policy.liveSmokeVerified)}`,
    `- Live smoke reference: ${config.policy.liveSmokeReference || 'not set'}`,
    readiness.ready ? '- Tournament autopilot: ready' : `- Tournament autopilot: blocked until ${readiness.missing.join(', ')}`,
    '',
    'What this means: policy controls execution safety. It is separate from prediction risk modes like conservative, balanced, or contrarian.',
  ].join('\n');
}

export function renderFriendlyOperatorPolicyUpdate(
  config: AgentConfig,
  result: PolicySwitchResult,
): string {
  return [
    'Operator Policy Updated',
    '',
    `Previous mode: ${policyTitle(result.previousMode)}`,
    `Current mode: ${policyTitle(result.nextMode)}`,
    `Stored runtime policy: ${result.persistedPolicyId}`,
    `Local .env updated: ${result.envPath}`,
    '',
    `Mode meaning: ${policyMeaning(result.nextMode)}`,
    'Render note: hosted workers load the stored runtime policy at startup; the Render env var remains the fallback if local memory is reset.',
    result.warning ? `Warning: ${result.warning}` : null,
    '',
    'What this means: this changes what the operator wallet is allowed to do. It does not change prediction strategy or risk preference.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function freebetOraclePrice(report: FreebetStatusReport): VaraUsdPriceSource | null {
  const price = report.oracle.varaUsdPrice;
  if (!price?.price_usd_micro) return null;
  try {
    const priceUsdMicro = BigInt(price.price_usd_micro);
    if (priceUsdMicro <= 0n) return null;
    return {
      source: 'oracle',
      priceUsdMicro,
      updatedAt: price.price_updated_at,
    };
  } catch {
    return null;
  }
}

function renderWarningBlock(warnings: string[]): string {
  if (warnings.length === 0) return 'Warnings: none.';
  const friendlyWarnings = renderFriendlySourceWarningBullets(warnings, 5);
  const fallbackWarnings = warnings
    .filter((warning) => /suspicious|implausibly large/i.test(warning))
    .map(() => 'A historical freebet principal value looked implausibly large and was ignored in usage totals.');
  const combined = [...new Set([...friendlyWarnings, ...fallbackWarnings])];
  if (combined.length === 0) return 'Warnings: supporting reads were degraded; rerun once before acting.';
  return ['Warnings:', ...combined.map((warning) => `- ${warning}`)].join('\n');
}

function formatMaybePlanck(value: string | null, price: VaraUsdPriceSource | null): string {
  return value === null ? 'unknown' : formatFriendlyPlanckAmount(value, price);
}

function formatAuthorization(value: boolean | null): string {
  if (value === null) return 'unknown';
  return value ? 'authorized' : 'not authorized';
}

function isPositivePlanck(value: string | null): boolean {
  if (!value) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

function formatUsdOrPlanckLimit(usd: string | null, planck: string): string {
  if (usd) return `$${usd} USD`;
  if (isPositivePlanck(planck)) return formatFriendlyPlanckAmount(planck, null);
  return 'not configured';
}

function policyModeLines(): string[] {
  return [
    `- ${policyTitle('read_only')}: no wallet execution. Analysis and reports only.`,
    `- ${policyTitle('approval_required')}: can submit only after explicit operator approval and all guards pass.`,
    `- ${policyTitle('claim_only')}: can plan/submit claims, but blocks new predictions.`,
    `- ${policyTitle('tournament_autopilot')}: reserved for production after approval flow and live smoke are verified.`,
  ];
}

function policyMeaning(mode: ExecutionMode): string {
  if (mode === 'read_only') return 'analysis and reports only; live wallet execution is blocked.';
  if (mode === 'approval_required') return 'live execution is possible only after explicit operator approval.';
  if (mode === 'claim_only') return 'claim/refund flows can run, but new prediction submissions are blocked.';
  return 'production autopilot mode; still blocked unless readiness checks are complete.';
}

function policyTitle(mode: ExecutionMode): string {
  if (mode === 'read_only') return 'Read Only';
  if (mode === 'approval_required') return 'Approval Required';
  if (mode === 'claim_only') return 'Claim Only';
  return 'Tournament Autopilot';
}

function formatYesNo(value: boolean | undefined): string {
  return value === undefined ? 'unknown' : value ? 'yes' : 'no';
}

function shortAddress(value: HexAddress | string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}
