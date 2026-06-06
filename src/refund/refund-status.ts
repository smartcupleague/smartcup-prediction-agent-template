import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import type {
  ActorId,
  AgentConfig,
  FinalPrizeClaimStatus,
  HexAddress,
  U128String,
  WalletClaimStatus,
} from '../types/index.js';

export type RefundStatusReport = {
  checkedAt: string;
  wallet: ActorId;
  bolaoCore: HexAddress;
  matchRewardClaimStatus: WalletClaimStatus | null;
  finalPrizeClaimStatus: FinalPrizeClaimStatus | null;
  pendingRefundPlanck: U128String | null;
  cancelledMatchBets: Array<{
    matchId: string;
    phase: string;
    stakeInMatchPoolPlanck: U128String;
    freebetPrincipalPlanck: U128String;
    claimed: boolean;
  }>;
  warnings: string[];
};

export async function buildRefundStatusReport(
  config: AgentConfig,
  options: { wallet?: ActorId } = {},
): Promise<RefundStatusReport> {
  const wallet = options.wallet ?? config.wallet.hexAddress;
  const chain = new BolaoChainClient(config);
  const warnings: string[] = [];

  // Keep these reads sequential. Each Bolao read shells out to vara-wallet, and
  // concurrent wallet subprocesses can exceed small Render worker memory limits.
  const stateResult = await capture(() => chain.queryState());
  const betsResult = await capture(() => chain.queryBetsByUser(wallet));
  const matchRewardResult = await capture(() => chain.queryWalletClaimStatus(wallet));
  const finalPrizeResult = await capture(() => chain.queryFinalPrizeClaimStatus(wallet));
  const pendingRefundResult = await capture(() => chain.queryPendingRefund(wallet));

  if (!stateResult.ok) warnings.push(`BolaoCore state read failed: ${stateResult.error}`);
  if (!betsResult.ok) warnings.push(`BolaoCore user bet read failed: ${betsResult.error}`);
  if (!matchRewardResult.ok) warnings.push(`Match reward claim status read failed: ${matchRewardResult.error}`);
  if (!finalPrizeResult.ok) warnings.push(`Final prize claim status read failed: ${finalPrizeResult.error}`);
  if (!pendingRefundResult.ok) warnings.push(`Refund recovery read failed: ${pendingRefundResult.error}`);

  const cancelledMatches = new Map(
    (stateResult.ok ? stateResult.value.matches : [])
      .filter((match) => match.result.kind === 'Cancelled')
      .map((match) => [String(match.match_id), match]),
  );

  const cancelledMatchBets = (betsResult.ok ? betsResult.value : [])
    .filter((bet) => cancelledMatches.has(String(bet.match_id)))
    .map((bet) => {
      const match = cancelledMatches.get(String(bet.match_id));
      return {
        matchId: bet.match_id,
        phase: match?.phase ?? 'unknown',
        stakeInMatchPoolPlanck: bet.stake_in_match_pool,
        freebetPrincipalPlanck: bet.freebet_principal,
        claimed: bet.claimed,
      };
    });

  return {
    checkedAt: new Date().toISOString(),
    wallet,
    bolaoCore: config.programs.bolaoCore,
    matchRewardClaimStatus: matchRewardResult.ok ? matchRewardResult.value : null,
    finalPrizeClaimStatus: finalPrizeResult.ok ? finalPrizeResult.value : null,
    pendingRefundPlanck: pendingRefundResult.ok ? pendingRefundResult.value : null,
    cancelledMatchBets,
    warnings,
  };
}

export function renderRefundStatusSummary(report: RefundStatusReport): string {
  return [
    `Wallet: ${report.wallet}`,
    `BolaoCore: ${report.bolaoCore}`,
    `Match reward claimable: ${formatPlanck(report.matchRewardClaimStatus?.amount_claimable ?? null)}`,
    `Match reward already claimed: ${formatBoolean(report.matchRewardClaimStatus?.already_claimed)}`,
    `Final prize finalized: ${formatBoolean(report.finalPrizeClaimStatus?.final_prize_finalized)}`,
    `Final prize eligible: ${formatBoolean(report.finalPrizeClaimStatus?.eligible)}`,
    `Final prize claimable: ${formatPlanck(report.finalPrizeClaimStatus?.amount_claimable ?? null)}`,
    `Final prize already claimed: ${formatBoolean(report.finalPrizeClaimStatus?.already_claimed)}`,
    `Refund recovery claimable: ${formatPlanck(report.pendingRefundPlanck)}`,
    `Cancelled-match bets: ${report.cancelledMatchBets.length}`,
    ...report.cancelledMatchBets.map(
      (bet) =>
        `- Match ${bet.matchId} (${bet.phase}) stake=${bet.stakeInMatchPoolPlanck} freebet=${bet.freebetPrincipalPlanck} claimed=${bet.claimed ? 'yes' : 'no'}`,
    ),
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

function formatPlanck(value: U128String | null): string {
  return value === null ? 'unknown' : `${value} planck`;
}

function formatBoolean(value: boolean | undefined): string {
  return value === undefined ? 'unknown' : value ? 'yes' : 'no';
}
