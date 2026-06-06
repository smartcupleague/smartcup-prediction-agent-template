import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { IndexerAdapter } from '../adapters/indexer-adapter.js';
import type {
  AgentConfig,
  PenaltyWinner,
  Score,
  StoredTransactionPlan,
  StoredTransactionResult,
} from '../types/index.js';

export type ConfirmationReadbackAction = 'confirmed' | 'not_confirmed' | 'manual_review_required';

export type ConfirmationReadbackReport = {
  generatedAt: string;
  planId: string;
  kind: StoredTransactionPlan['kind'];
  action: ConfirmationReadbackAction;
  reason: string;
  readback: unknown;
};

export class ConfirmationReadbackAdvisor {
  private readonly chain: BolaoChainClient;

  constructor(
    private readonly config: AgentConfig,
    deps?: {
      chain?: BolaoChainClient;
    },
  ) {
    this.chain = deps?.chain ?? new BolaoChainClient(config);
  }

  async confirmAfterSubmit(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    try {
      if (plan.kind === 'PlaceBet') return this.confirmPlaceBet(plan);
      if (plan.kind === 'SpendFreebet') return this.confirmSpendFreebet(plan);
      if (plan.kind === 'ClaimMatchReward') return this.confirmClaimMatchReward(plan);
      if (plan.kind === 'ClaimRefund') return this.confirmClaimRefund(plan);
      if (plan.kind === 'ClaimFinalPrize') return this.confirmClaimFinalPrize(plan);

      return this.manualReview(plan, {
        note: 'SubmitPodiumPick currently has no wallet-scoped on-chain readback in the agent adapter.',
      });
    } catch (error) {
      return this.notConfirmed(plan, 'Confirmation readback failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  confirmationResult(
    plan: StoredTransactionPlan,
    submittedResult: StoredTransactionResult,
    report: ConfirmationReadbackReport,
  ): StoredTransactionResult {
    const createdAt = new Date().toISOString();
    const confirmed = report.action === 'confirmed';
    return {
      id: `txresult-${plan.id}-confirmation-${createdAt.replace(/[:.]/g, '-')}`,
      planId: plan.id,
      createdAt,
      updatedAt: createdAt,
      status: confirmed ? 'confirmed' : 'unknown',
      txHash: submittedResult.txHash,
      messageId: submittedResult.messageId,
      blockHash: submittedResult.blockHash,
      blockNumber: submittedResult.blockNumber,
      error: confirmed ? null : report.reason,
      chainReadback: report.readback,
      payload: {
        submittedResult,
        confirmation: report,
      },
    };
  }

  private async confirmPlaceBet(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    const matchId = String(plan.args[0] ?? '');
    const expectedScore = plan.args[1] as Score | undefined;
    const expectedPenaltyWinner = (plan.args[2] ?? null) as PenaltyWinner | null;
    const bets = await this.chain.queryBetsByUser(this.config.wallet.hexAddress);
    const landed = bets.find((bet) => String(bet.match_id) === matchId);

    if (!landed) {
      const indexerBets = await new IndexerAdapter(
        this.config.services.indexerGraphqlUrl,
        this.config.services.indexerGraphqlTimeoutMs,
      ).listBets({
        user: this.config.wallet.hexAddress,
        matchId,
        first: 5,
      });
      const indexerLanded = indexerBets.find((bet) => String(bet.matchId) === matchId);
      const sameIndexerScore =
        expectedScore !== undefined &&
        indexerLanded?.scoreHome === expectedScore.home &&
        indexerLanded?.scoreAway === expectedScore.away;
      const sameIndexerPenaltyWinner = (indexerLanded?.penaltyWinner ?? null) === expectedPenaltyWinner;

      if (indexerLanded && sameIndexerScore && sameIndexerPenaltyWinner) {
        return this.confirmed(
          plan,
          'Indexer readback confirms the PlaceBet event; BolaoCore QueryBetsByUser did not expose the planned match.',
          {
            matchId,
            chainCheckedBetCount: bets.length,
            indexerBet: indexerLanded,
            note: 'Using indexer event projection as fallback because wallet-scoped BolaoCore readback did not expose the planned match.',
          },
        );
      }

      return this.notConfirmed(plan, 'No PlaceBet readback found for the planned match.', {
        matchId,
        checkedBetCount: bets.length,
        checkedIndexerBetCount: indexerBets.length,
      });
    }

    const sameScore =
      expectedScore !== undefined &&
      landed.score.home === expectedScore.home &&
      landed.score.away === expectedScore.away;
    const samePenaltyWinner = landed.penalty_winner === expectedPenaltyWinner;

    if (sameScore && samePenaltyWinner) {
      return this.confirmed(plan, 'PlaceBet readback matches the planned score and penalty winner.', {
        matchId,
        landedBet: landed,
      });
    }

    return this.manualReview(plan, {
      matchId,
      expectedScore,
      expectedPenaltyWinner,
      landedBet: landed,
      note: 'A bet exists for the match, but it does not exactly match the planned payload.',
    });
  }

  private async confirmSpendFreebet(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    const matchId = String(plan.args[1] ?? '');
    const expectedAmountPlanck = String(plan.args[2] ?? '0');
    const expectedScore = plan.args[3] as Score | undefined;
    const expectedPenaltyWinner = (plan.args[4] ?? null) as PenaltyWinner | null;
    const bets = await this.chain.queryBetsByUser(this.config.wallet.hexAddress);
    const landed = bets.find((bet) => String(bet.match_id) === matchId);

    if (!landed) {
      return this.notConfirmed(plan, 'No SpendFreebet readback found for the planned match.', {
        matchId,
        checkedBetCount: bets.length,
      });
    }

    const sameScore =
      expectedScore !== undefined &&
      landed.score.home === expectedScore.home &&
      landed.score.away === expectedScore.away;
    const samePenaltyWinner = landed.penalty_winner === expectedPenaltyWinner;
    const freebetPrincipalMatches = landed.freebet_principal === expectedAmountPlanck;
    const freebetPrincipalPositive = BigInt(landed.freebet_principal || '0') > 0n;

    if (sameScore && samePenaltyWinner && freebetPrincipalMatches && freebetPrincipalPositive) {
      return this.confirmed(
        plan,
        'SpendFreebet readback matches the planned score, penalty winner, and freebet principal.',
        {
          matchId,
          expectedAmountPlanck,
          landedBet: landed,
        },
      );
    }

    return this.manualReview(plan, {
      matchId,
      expectedAmountPlanck,
      expectedScore,
      expectedPenaltyWinner,
      landedBet: landed,
      sameScore,
      samePenaltyWinner,
      freebetPrincipalMatches,
      freebetPrincipalPositive,
      note: 'A bet exists for the match, but the freebet-backed readback does not exactly match the planned payload.',
    });
  }

  private async confirmClaimMatchReward(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    const matchId = String(plan.args[0] ?? '');
    const bets = await this.chain.queryBetsByUser(this.config.wallet.hexAddress);
    const landed = bets.find((bet) => String(bet.match_id) === matchId);

    if (landed?.claimed) {
      return this.confirmed(plan, 'ClaimMatchReward readback shows the match bet is claimed.', {
        matchId,
        landedBet: landed,
      });
    }

    return this.notConfirmed(plan, 'ClaimMatchReward readback does not show a claimed match bet.', {
      matchId,
      matchingBet: landed ?? null,
    });
  }

  private async confirmClaimRefund(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    const pendingRefundPlanck = await this.chain.queryPendingRefund(this.config.wallet.hexAddress);

    if (BigInt(pendingRefundPlanck) === 0n) {
      return this.confirmed(plan, 'ClaimRefund readback shows no pending refund remaining for the wallet.', {
        wallet: this.config.wallet.hexAddress,
        pendingRefundPlanck,
      });
    }

    return this.notConfirmed(plan, 'ClaimRefund readback still shows a pending refund for the wallet.', {
      wallet: this.config.wallet.hexAddress,
      pendingRefundPlanck,
    });
  }

  private async confirmClaimFinalPrize(plan: StoredTransactionPlan): Promise<ConfirmationReadbackReport> {
    const status = await this.chain.queryFinalPrizeClaimStatus(this.config.wallet.hexAddress);

    if (status.already_claimed) {
      return this.confirmed(plan, 'ClaimFinalPrize readback shows final prize already claimed.', {
        finalPrizeClaimStatus: status,
      });
    }

    return this.notConfirmed(plan, 'ClaimFinalPrize readback does not show an already-claimed final prize.', {
      finalPrizeClaimStatus: status,
    });
  }

  private confirmed(
    plan: StoredTransactionPlan,
    reason: string,
    readback: unknown,
  ): ConfirmationReadbackReport {
    return this.report(plan, 'confirmed', reason, readback);
  }

  private notConfirmed(
    plan: StoredTransactionPlan,
    reason: string,
    readback: unknown,
  ): ConfirmationReadbackReport {
    return this.report(plan, 'not_confirmed', reason, readback);
  }

  private manualReview(plan: StoredTransactionPlan, readback: unknown): ConfirmationReadbackReport {
    return this.report(
      plan,
      'manual_review_required',
      'Confirmation readback is inconclusive; manual review is required.',
      readback,
    );
  }

  private report(
    plan: StoredTransactionPlan,
    action: ConfirmationReadbackAction,
    reason: string,
    readback: unknown,
  ): ConfirmationReadbackReport {
    return {
      generatedAt: new Date().toISOString(),
      planId: plan.id,
      kind: plan.kind,
      action,
      reason,
      readback,
    };
  }
}
