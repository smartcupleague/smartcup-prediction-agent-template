import { AccountReadinessAdapter } from '../adapters/account-readiness.js';
import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { SmartCupApiAdapter } from '../adapters/smartcup-api-adapter.js';
import { formatUsdAmount, planckToUsdString, readVaraUsdPrice } from '../economics/vara-usd-converter.js';
import { MemoryStore } from '../memory/memory-store.js';
import type { TournamentProfileOption } from '../tournament/index.js';
import type { AgentConfig, IoSmartCupState, StoredOutcomeEvaluation } from '../types/index.js';
import { renderFriendlyAgentStatus } from './friendly-agent-status-renderer.js';

export async function renderAgentTournamentStatus(
  config: AgentConfig,
  tournament: TournamentProfileOption | null,
): Promise<string> {
  const readiness = await new AccountReadinessAdapter(config).check();
  const memory = new MemoryStore();
  const state = await queryStateOrNull(config);
  const apiLeaderboard = await queryApiLeaderboardOrNull(config);
  const leaderboard = summarizeLeaderboard(state, apiLeaderboard, config.wallet.hexAddress);
  const tournamentDecisionIds =
    tournament === null
      ? null
      : new Set(
          memory
            .listDecisions()
            .filter((decision) => decision.tournament.id === tournament.tournamentId)
            .map((decision) => decision.id),
        );
  const evaluations = summarizeEvaluations(
    tournamentDecisionIds === null
      ? memory.listOutcomeEvaluations()
      : memory.listOutcomeEvaluations().filter((evaluation) => tournamentDecisionIds.has(evaluation.decisionId)),
  );
  const profileName = readiness.smartcup.profile.displayName ?? 'not available';
  const predictionCount = readiness.smartcup.currentPredictions.bets.length;
  const points = readiness.smartcup.points.value ?? leaderboard.points ?? 0;
  const balance = await renderBalance(config, readiness.wallet.balance.raw);

  return renderFriendlyAgentStatus({
    tournament: {
      name: tournament?.name ?? 'Active tournament profile',
      id: tournament?.tournamentId ?? null,
    },
    account: {
      accountName: config.wallet.accountName,
      nickname: profileName,
      wallet: config.wallet.hexAddress,
      ss58: config.wallet.ss58Address,
      balance,
    },
    stats: {
      rank: leaderboard.rank,
      rankSource: leaderboard.source,
      points,
      predictionCount,
      evaluated: evaluations.evaluated,
      pending: evaluations.pending,
      exactHits: evaluations.exactHits,
      outcomeHits: evaluations.outcomeHits,
      awardedWeightedPoints: evaluations.awardedWeightedPoints,
      behindNext: leaderboard.behindNext,
      aheadOfNext: leaderboard.aheadOfNext,
    },
    execution: {
      policyMode: config.policy.mode,
      readyForAutonomousWrites: readiness.readyForAutonomousWrites,
    },
    notes: buildStatusNotes(leaderboard.source, state, tournamentDecisionIds),
  });
}

async function queryStateOrNull(config: AgentConfig): Promise<IoSmartCupState | null> {
  try {
    return await new BolaoChainClient(config).queryState();
  } catch {
    return null;
  }
}

async function queryApiLeaderboardOrNull(config: AgentConfig): Promise<Array<{ wallet_address: string; display_name: string | null }> | null> {
  try {
    return (await new SmartCupApiAdapter(config.services.smartcupApiUrl).getLeaderboardEnrichment()).rows;
  } catch {
    return null;
  }
}

function summarizeLeaderboard(
  state: IoSmartCupState | null,
  apiRows: Array<{ wallet_address: string; display_name: string | null }> | null,
  wallet: string,
): {
  rank: number | null;
  points: number | null;
  behindNext: number | null;
  aheadOfNext: number | null;
  source: 'chain' | 'smartcup_api' | 'none';
} {
  const rows = [...(state?.user_points ?? [])].sort((left, right) => right.points - left.points);
  const index = rows.findIndex((row) => row.actor_id.toLowerCase() === wallet.toLowerCase());
  if (index < 0) {
    const apiIndex = (apiRows ?? []).findIndex((row) => row.wallet_address.toLowerCase() === wallet.toLowerCase());
    if (rows.length === 0 && apiIndex >= 0) {
      return { rank: apiIndex + 1, points: 0, behindNext: null, aheadOfNext: null, source: 'smartcup_api' };
    }
    return { rank: null, points: null, behindNext: null, aheadOfNext: null, source: 'none' };
  }

  const row = rows[index];
  if (!row) return { rank: null, points: null, behindNext: null, aheadOfNext: null, source: 'none' };
  const previous = rows[index - 1] ?? null;
  const next = rows[index + 1] ?? null;
  return {
    rank: index + 1,
    points: row.points,
    behindNext: previous ? Math.max(0, previous.points - row.points) : 0,
    aheadOfNext: next ? Math.max(0, row.points - next.points) : null,
    source: 'chain',
  };
}

function summarizeEvaluations(evaluations: StoredOutcomeEvaluation[]): {
  evaluated: number;
  pending: number;
  exactHits: number;
  outcomeHits: number;
  awardedWeightedPoints: number;
} {
  let awardedWeightedPoints = 0;
  let exactHits = 0;
  let outcomeHits = 0;

  for (const evaluation of evaluations) {
    if (typeof evaluation.points.awardedWeightedPoints === 'number') {
      awardedWeightedPoints += evaluation.points.awardedWeightedPoints;
    }
    if (evaluation.actual.score) {
      const exact =
        evaluation.actual.score.home === evaluation.predicted.score.home &&
        evaluation.actual.score.away === evaluation.predicted.score.away;
      if (exact) exactHits += 1;
    }
    if (evaluation.actual.outcome && evaluation.actual.outcome === evaluation.predicted.outcome) {
      outcomeHits += 1;
    }
  }

  return {
    evaluated: evaluations.filter((evaluation) => evaluation.status === 'evaluated').length,
    pending: evaluations.filter((evaluation) => evaluation.status === 'pending').length,
    exactHits,
    outcomeHits,
    awardedWeightedPoints,
  };
}

async function renderBalance(config: AgentConfig, raw: unknown): Promise<string> {
  if (raw && typeof raw === 'object' && 'balance' in raw) {
    const record = raw as { balance?: unknown; balancePlanck?: unknown; balance_planck?: unknown; freePlanck?: unknown; free_planck?: unknown };
    const balance = record.balance;
    if (typeof balance === 'string' && balance.length > 0) {
      const usd = await renderUsdValue(config, record, balance);
      return usd ? `${balance} VARA (~${formatUsdAmount(usd)} USD)` : `${balance} VARA (USD conversion unavailable)`;
    }
  }
  return 'not available';
}

function buildStatusNotes(
  leaderboardSource: 'chain' | 'smartcup_api' | 'none',
  state: IoSmartCupState | null,
  tournamentDecisionIds: Set<string> | null,
): string[] {
  const notes: string[] = [];
  if (leaderboardSource === 'smartcup_api') {
    notes.push('Rank comes from SmartCup API profile/participation rows until on-chain results award points.');
  } else if (!state?.user_points.length) {
    notes.push('Live user_points did not expose a full competitor table yet, so rank gap may be unavailable.');
  }
  if (tournamentDecisionIds !== null && tournamentDecisionIds.size === 0) {
    notes.push('No saved DecisionReports were found for this tournament yet, so evaluated/pending local stats may be empty.');
  }
  return notes;
}

async function renderUsdValue(
  config: AgentConfig,
  raw: { balancePlanck?: unknown; balance_planck?: unknown; freePlanck?: unknown; free_planck?: unknown },
  balanceVara: string,
): Promise<string | null> {
  const planck =
    stringCandidate(raw.balancePlanck) ??
    stringCandidate(raw.balance_planck) ??
    stringCandidate(raw.freePlanck) ??
    stringCandidate(raw.free_planck) ??
    varaDecimalToPlanck(balanceVara);
  if (!planck) return null;

  try {
    const price = await readVaraUsdPrice(config);
    return planckToUsdString(planck, price);
  } catch {
    return null;
  }
}

function stringCandidate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

function varaDecimalToPlanck(value: string): string | null {
  const normalized = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,12})?$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'))}`;
}
