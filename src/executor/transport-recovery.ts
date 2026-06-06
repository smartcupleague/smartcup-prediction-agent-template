import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import type { AgentConfig, StoredTransactionPlan, StoredTransactionResult } from '../types/index.js';

export type TransportRecoveryAction = 'retry_allowed' | 'retry_blocked' | 'manual_review_required';

export type TransportRecoveryReport = {
  generatedAt: string;
  planId: string;
  kind: StoredTransactionPlan['kind'];
  action: TransportRecoveryAction;
  reason: string;
  readback: unknown;
  originalError: string;
};

export class TransportRecoveryAdvisor {
  private readonly chain: BolaoChainClient;

  constructor(
    private readonly config: AgentConfig,
    deps?: {
      chain?: BolaoChainClient;
    },
  ) {
    this.chain = deps?.chain ?? new BolaoChainClient(config);
  }

  async requeryBeforeRetry(
    plan: StoredTransactionPlan,
    transportError: unknown,
  ): Promise<TransportRecoveryReport> {
    const originalError = transportError instanceof Error ? transportError.message : String(transportError);

    try {
      if (plan.kind === 'PlaceBet') {
        return this.recoverPlaceBet(plan, originalError);
      }
      if (plan.kind === 'ClaimMatchReward') {
        return this.recoverClaimMatchReward(plan, originalError);
      }
      if (plan.kind === 'ClaimFinalPrize') {
        return this.recoverClaimFinalPrize(plan, originalError);
      }

      return this.manualReview(plan, originalError, {
        note: 'SubmitPodiumPick currently has no wallet-scoped on-chain readback in the agent adapter.',
      });
    } catch (error) {
      return this.manualReview(plan, originalError, {
        recoveryReadbackError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  recoveryResult(
    plan: StoredTransactionPlan,
    failedResult: StoredTransactionResult,
    report: TransportRecoveryReport,
  ): StoredTransactionResult {
    const createdAt = new Date().toISOString();
    return {
      id: `txresult-${plan.id}-transport-recovery-${createdAt.replace(/[:.]/g, '-')}`,
      planId: plan.id,
      createdAt,
      updatedAt: createdAt,
      status: report.action === 'retry_allowed' ? 'unknown' : 'failed',
      txHash: failedResult.txHash,
      messageId: failedResult.messageId,
      blockHash: failedResult.blockHash,
      blockNumber: failedResult.blockNumber,
      error:
        report.action === 'retry_allowed'
          ? 'Transport failure recovered with no landed transaction observed; retry may be considered after guards re-run.'
          : report.reason,
      chainReadback: report.readback,
      payload: {
        failedResult,
        recovery: report,
      },
    };
  }

  private async recoverPlaceBet(
    plan: StoredTransactionPlan,
    originalError: string,
  ): Promise<TransportRecoveryReport> {
    const matchId = String(plan.args[0] ?? '');
    const bets = await this.chain.queryBetsByUser(this.config.wallet.hexAddress);
    const landed = bets.find((bet) => String(bet.match_id) === matchId);
    if (landed) {
      return this.retryBlocked(plan, originalError, 'PlaceBet appears to have landed; duplicate retry is blocked.', {
        matchId,
        landedBet: landed,
      });
    }

    return this.retryAllowed(plan, originalError, 'No PlaceBet readback found for the planned match.', {
      matchId,
      checkedBetCount: bets.length,
    });
  }

  private async recoverClaimMatchReward(
    plan: StoredTransactionPlan,
    originalError: string,
  ): Promise<TransportRecoveryReport> {
    const matchId = String(plan.args[0] ?? '');
    const bets = await this.chain.queryBetsByUser(this.config.wallet.hexAddress);
    const bet = bets.find((entry) => String(entry.match_id) === matchId);
    if (bet?.claimed) {
      return this.retryBlocked(plan, originalError, 'ClaimMatchReward appears to have landed; retry is blocked.', {
        matchId,
        landedBet: bet,
      });
    }

    return this.retryAllowed(plan, originalError, 'No claimed match reward readback found for the planned match.', {
      matchId,
      matchingBet: bet ?? null,
    });
  }

  private async recoverClaimFinalPrize(
    plan: StoredTransactionPlan,
    originalError: string,
  ): Promise<TransportRecoveryReport> {
    const status = await this.chain.queryFinalPrizeClaimStatus(this.config.wallet.hexAddress);
    if (status.already_claimed) {
      return this.retryBlocked(plan, originalError, 'ClaimFinalPrize appears to have landed; retry is blocked.', {
        finalPrizeClaimStatus: status,
      });
    }

    return this.retryAllowed(plan, originalError, 'Final prize claim readback is not already claimed.', {
      finalPrizeClaimStatus: status,
    });
  }

  private retryAllowed(
    plan: StoredTransactionPlan,
    originalError: string,
    reason: string,
    readback: unknown,
  ): TransportRecoveryReport {
    return this.report(plan, 'retry_allowed', reason, readback, originalError);
  }

  private retryBlocked(
    plan: StoredTransactionPlan,
    originalError: string,
    reason: string,
    readback: unknown,
  ): TransportRecoveryReport {
    return this.report(plan, 'retry_blocked', reason, readback, originalError);
  }

  private manualReview(
    plan: StoredTransactionPlan,
    originalError: string,
    readback: unknown,
  ): TransportRecoveryReport {
    return this.report(
      plan,
      'manual_review_required',
      'Recovery readback could not prove whether the transaction landed; do not retry automatically.',
      readback,
      originalError,
    );
  }

  private report(
    plan: StoredTransactionPlan,
    action: TransportRecoveryAction,
    reason: string,
    readback: unknown,
    originalError: string,
  ): TransportRecoveryReport {
    return {
      generatedAt: new Date().toISOString(),
      planId: plan.id,
      kind: plan.kind,
      action,
      reason,
      readback,
      originalError,
    };
  }
}
