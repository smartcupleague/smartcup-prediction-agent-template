import { createHash } from 'node:crypto';
import type {
  AgentConfig,
  EligibleMatchPlan,
  MatchEligibilityView,
  StoredTelegramPredictionAlert,
} from '../types/index.js';
import type { TournamentProfileOption } from '../tournament/index.js';
import { MemoryStore } from '../memory/memory-store.js';

export type PredictionClosingAlertCandidate = {
  chatId: string;
  tournament: TournamentProfileOption;
  match: MatchEligibilityView;
  alertLeadMinutes: number;
  predictionCutoffAt: string;
  agentSafetyCloseAt: string;
  kickOffAt: string;
  text: string;
  record: StoredTelegramPredictionAlert;
};

export function resolvePredictionAlertChatIds(config: AgentConfig): string[] {
  return [...new Set(
    (config.telegram.predictionAlertChatIds.length > 0
      ? config.telegram.predictionAlertChatIds
      : config.telegram.adminIds
    )
      .map((id) => id.trim())
      .filter(Boolean),
  )];
}

export function buildDuePredictionClosingAlerts(input: {
  config: AgentConfig;
  memory: MemoryStore;
  tournament: TournamentProfileOption;
  plan: EligibleMatchPlan;
  nowMs?: number;
}): PredictionClosingAlertCandidate[] {
  if (!input.config.telegram.predictionAlertsEnabled) return [];
  const chatIds = resolvePredictionAlertChatIds(input.config);
  if (chatIds.length === 0) return [];

  const nowMs = input.nowMs ?? Date.now();
  const leadMinutes = input.config.telegram.predictionAlertLeadMinutes;
  const leadMs = leadMinutes * 60_000;
  const sent = new Set(input.memory.listTelegramPredictionAlerts().map((alert) => alert.id));
  const dueMatches = input.plan.eligibleMatches.filter((match) => {
    const timeUntilCutoffMs = match.predictionCutoffMs - nowMs;
    return timeUntilCutoffMs > 0 && timeUntilCutoffMs <= leadMs;
  });

  const candidates: PredictionClosingAlertCandidate[] = [];
  for (const match of dueMatches) {
    for (const chatId of chatIds) {
      const record = buildPredictionClosingAlertRecord({
        config: input.config,
        tournament: input.tournament,
        match,
        chatId,
        leadMinutes,
        nowMs,
      });
      if (sent.has(record.id)) continue;
      candidates.push({
        chatId,
        tournament: input.tournament,
        match,
        alertLeadMinutes: leadMinutes,
        predictionCutoffAt: record.predictionCutoffAt,
        agentSafetyCloseAt: record.agentSafetyCloseAt,
        kickOffAt: record.kickOffAt,
        text: renderPredictionClosingAlert(record),
        record,
      });
    }
  }
  return candidates;
}

function buildPredictionClosingAlertRecord(input: {
  config: AgentConfig;
  tournament: TournamentProfileOption;
  match: MatchEligibilityView;
  chatId: string;
  leadMinutes: number;
  nowMs: number;
}): StoredTelegramPredictionAlert {
  const createdAt = new Date(input.nowMs).toISOString();
  const predictionCutoffAt = new Date(input.match.predictionCutoffMs).toISOString();
  const agentSafetyCloseAt = new Date(input.match.agentSafetyCloseMs).toISOString();
  const kickOffAt = new Date(input.match.kickOffMs).toISOString();
  const id = [
    'telegram-prediction-alert',
    hashAlertId(`${input.chatId}:${input.tournament.tournamentId}:${input.match.matchId}:${input.leadMinutes}`),
  ].join('-');
  return {
    id,
    createdAt,
    sentAt: createdAt,
    chatId: input.chatId,
    tournamentId: input.tournament.tournamentId,
    tournamentName: input.tournament.name,
    matchId: input.match.matchId,
    home: input.match.home,
    away: input.match.away,
    phase: input.match.phase,
    kickOffAt,
    predictionCutoffAt,
    agentSafetyCloseAt,
    alertLeadMinutes: input.leadMinutes,
    walletAddress: input.config.wallet.hexAddress,
    payload: {
      source: 'telegram_prediction_closing_alert',
      predictionCutoffMinutesBeforeKickoff: Math.round((input.match.kickOffMs - input.match.predictionCutoffMs) / 60_000),
      agentSafetyBufferMs: input.match.predictionCutoffMs - input.match.agentSafetyCloseMs,
    },
  };
}

function renderPredictionClosingAlert(alert: StoredTelegramPredictionAlert): string {
  return [
    'Prediction window alert',
    '',
    `Tournament: ${alert.tournamentName}`,
    `Match #${alert.matchId}: ${alert.home} vs ${alert.away}`,
    `Phase: ${alert.phase}`,
    '',
    `SmartCup prediction closes at: ${alert.predictionCutoffAt}`,
    `Kickoff: ${alert.kickOffAt}`,
    `Reminder: about ${alert.alertLeadMinutes} minutes remain before the SmartCup prediction close.`,
    '',
    'What this means',
    '- SmartCup closes predictions 10 minutes before kickoff.',
    '- The agent also uses a safety buffer, so approve only after a fresh preview and guard checks.',
    '',
    'Next action',
    `Ask for "preview match ${alert.matchId}" or open /menu -> Predict -> Single Match.`,
    'If you want execution, use Approve Plan only after reviewing the saved prediction preview.',
  ].join('\n');
}

function hashAlertId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
