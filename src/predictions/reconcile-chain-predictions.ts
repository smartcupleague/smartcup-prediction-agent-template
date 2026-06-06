import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { MemoryStore } from '../memory/index.js';
import type { ActorId, AgentConfig, PredictionSource, StoredPrediction, UserBetView } from '../types/index.js';

const RECONCILABLE_SOURCES: PredictionSource[] = ['manual', 'imported_chain'];

export type PredictionReconciliationReport = {
  generatedAt: string;
  wallet: ActorId;
  removedPredictionIds: string[];
  upsertedPredictions: StoredPrediction[];
  finalPredictionCount: number;
  notes: string[];
};

export async function reconcileChainPredictions(
  config: AgentConfig,
  memory = new MemoryStore(),
): Promise<PredictionReconciliationReport> {
  const wallet = config.wallet.hexAddress;
  const existing = memory
    .listPredictions()
    .filter((prediction) => prediction.walletAddress === wallet && RECONCILABLE_SOURCES.includes(prediction.source));
  const chainBets = await new BolaoChainClient(config).queryBetsByUser(wallet);
  const now = new Date().toISOString();

  const byMatchId = new Map(existing.map((prediction) => [String(prediction.matchId), prediction]));
  const nextPredictions = chainBets.map((bet) => toStoredPrediction(wallet, bet, byMatchId.get(String(bet.match_id)), now));
  const nextIds = new Set(nextPredictions.map((prediction) => prediction.id));
  const removedPredictionIds = existing
    .filter((prediction) => !nextIds.has(prediction.id))
    .map((prediction) => prediction.id);

  memory.replacePredictionsForWalletSources(wallet, RECONCILABLE_SOURCES, nextPredictions);

  const notes: string[] = [];
  if (removedPredictionIds.length > 0) {
    notes.push(`Removed ${removedPredictionIds.length} stale local prediction record(s) no longer present in QueryBetsByUser.`);
  }
  if (nextPredictions.some((prediction) => prediction.source === 'imported_chain')) {
    notes.push('Chain-only predictions are stored as source imported_chain.');
  }
  if (nextPredictions.some((prediction) => prediction.source === 'manual')) {
    notes.push('Matching legacy manual rows were preserved where chain state still aligned on the same match.');
  }
  if (nextPredictions.some((prediction) => prediction.notes?.includes('Suspicious freebet_principal'))) {
    notes.push('At least one chain bet had a suspicious freebet_principal, so reconciled amountPlanck fell back to visible stake_in_match_pool.');
  }

  return {
    generatedAt: now,
    wallet,
    removedPredictionIds,
    upsertedPredictions: nextPredictions,
    finalPredictionCount: memory.listPredictions().filter((prediction) => prediction.walletAddress === wallet).length,
    notes,
  };
}

function toStoredPrediction(
  wallet: ActorId,
  bet: UserBetView,
  previous: StoredPrediction | undefined,
  importedAt: string,
): StoredPrediction {
  const source = previous?.source === 'manual' ? 'manual' : 'imported_chain';
  const createdAt = previous?.createdAt ?? importedAt;
  const id = previous?.id ?? `${source}:${wallet}:${bet.match_id}`;
  const amount = derivePredictionAmounts(bet);
  const noteParts = [
    previous?.notes,
    `Reconciled from live chain QueryBetsByUser at ${importedAt}.`,
    amount.suspiciousFreebetPrincipal
      ? 'Suspicious freebet_principal was ignored for amountPlanck derivation; using visible stake_in_match_pool instead.'
      : null,
    amount.usedFreebetPrincipal
      ? 'amountPlanck reflects non-suspicious freebet_principal; matchPoolAmountPlanck remains visible stake_in_match_pool.'
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    id,
    source,
    walletAddress: wallet,
    matchId: bet.match_id,
    score: bet.score,
    penaltyWinner: bet.penalty_winner,
    predictedOutcome: outcomeForScore(bet.score),
    amountPlanck: amount.amountPlanck,
    matchPoolAmountPlanck: bet.stake_in_match_pool,
    createdAt,
    importedAt,
    notes: noteParts.join(' '),
  };
}

function derivePredictionAmounts(bet: UserBetView): {
  amountPlanck: StoredPrediction['amountPlanck'];
  usedFreebetPrincipal: boolean;
  suspiciousFreebetPrincipal: boolean;
} {
  const visibleStake = BigInt(bet.stake_in_match_pool || '0');
  const freebetPrincipal = BigInt(bet.freebet_principal || '0');
  const suspiciousFreebetPrincipal = isSuspiciousFreebetPrincipal(freebetPrincipal, visibleStake);

  if (freebetPrincipal > 0n && !suspiciousFreebetPrincipal) {
    return {
      amountPlanck: bet.freebet_principal,
      usedFreebetPrincipal: true,
      suspiciousFreebetPrincipal: false,
    };
  }

  return {
    amountPlanck: bet.stake_in_match_pool,
    usedFreebetPrincipal: false,
    suspiciousFreebetPrincipal,
  };
}

function isSuspiciousFreebetPrincipal(freebetPrincipal: bigint, visibleStake: bigint): boolean {
  if (freebetPrincipal <= 0n) return false;
  if (visibleStake <= 0n) return freebetPrincipal > 10_000_000_000_000_000_000n;
  return freebetPrincipal > visibleStake * 100n;
}

function outcomeForScore(score: StoredPrediction['score']): StoredPrediction['predictedOutcome'] {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}
