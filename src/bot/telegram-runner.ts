import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { buildEligibleMatchPlanForWallet } from '../adapters/eligible-match-plan.js';
import { assertReusableProductionSetup } from '../config/index.js';
import { usdToPlanck } from '../economics/vara-usd-converter.js';
import { buildFreebetStatusReport } from '../freebet/index.js';
import { MemoryStore } from '../memory/memory-store.js';
import { DEFAULT_TEAM_RATINGS } from '../models/team-rating-model.js';
import { buildRefundStatusReport } from '../refund/index.js';
import { PostMatchCalibrationModel } from '../models/index.js';
import {
  buildPersonalReportExport,
  buildPersonalSavedReportLookup,
  type PersonalReportExportFormat,
} from '../reports/index.js';
import { ANALYSIS_BUNDLE_TARGET_MATCH_COUNT } from '../products/index.js';
import {
  buildDecisionForMatch,
  buildBundleDecisions,
  buildPersonalPodiumStrategyReport,
  buildPersonalTournamentAdvisoryReport,
} from '../strategy/index.js';
import { reconcileChainPredictions } from '../predictions/index.js';
import { listTournamentProfileOptions, loadTournamentProfile, type TournamentProfileOption } from '../tournament/index.js';
import type {
  ActorId,
  AgentConfig,
  DecisionReport,
  FundingSource,
  MatchEligibilityView,
  ParserTelemetryActionTaken,
  ParserTelemetrySafetyOutcome,
  PenaltyWinner,
  PodiumStrategyReport,
  RiskMode,
  Score,
  StoredParserTelemetry,
  StoredTransactionResult,
  StoredTransactionPlan,
  StoredTelegramPreference,
  TransactionKind,
  U128String,
} from '../types/index.js';
import { renderAgentTournamentStatus } from './agent-status.js';
import { resolveTelegramMessageRoute } from './command-router.js';
import {
  buildEligibleMatchPicker,
  renderEligibleMatchLabel,
  renderEligibleMatchLine,
} from './eligible-match-picker.js';
import { renderFriendlyAlternativePicks } from './friendly-alternatives-renderer.js';
import { renderFriendlyPersonalBundle } from './friendly-bundle-renderer.js';
import { renderFriendlyTournamentAdvisory } from './friendly-advisory-renderer.js';
import {
  renderFriendlyExportCompletion,
  renderFriendlyExportContentHeader,
  renderFriendlyExportError,
  renderFriendlyExportPrompt,
  renderFriendlyExportUnavailable,
} from './friendly-export-renderer.js';
import {
  renderFriendlySourceFallback,
  renderFriendlySourceWarningBullets,
} from './friendly-source-fallback-renderer.js';
import {
  renderFriendlyPostMatchCalibration,
  renderFriendlyPredictionHistory,
} from './friendly-history-calibration-renderer.js';
import { renderFriendlyPodiumStrategy } from './friendly-podium-renderer.js';
import { renderFriendlyTournamentPositionStrategy } from './friendly-position-renderer.js';
import { renderFriendlySavedReportLookup } from './friendly-saved-reports-renderer.js';
import { renderFriendlyTimingStrategy } from './friendly-timing-renderer.js';
import {
  renderFriendlyDataProviderStatus,
  renderFriendlyExposureStakeLimits,
  renderFriendlyFreebetStatus,
  renderFriendlyRefundStatus,
} from './friendly-wallet-safety-renderer.js';
import { renderFriendlyPredictionPreview } from './friendly-prediction-renderer.js';
import {
  renderFriendlyLiveExecutionResult,
  type FriendlyLiveExecutionPayload,
} from './friendly-live-execution-renderer.js';
import { decisionReportVaraUsdPrice, formatFriendlyPlanckAmount } from './friendly-money.js';
import { buildTelegramNaturalLanguageClarification } from './natural-language-clarification.js';
import { handleTelegramOperatorCommand } from './operator-commands.js';
import { parseTelegramNaturalLanguage } from './natural-language-parser.js';
import {
  buildDuePredictionClosingAlerts,
  resolvePredictionAlertChatIds,
} from './prediction-alerts.js';
import {
  adminCommands,
  normalizeTelegramId,
  TelegramPermissionModel,
  type TelegramUserContext,
} from './permissions.js';
import {
  buildTelegramPreference,
  defaultTelegramPreference,
  renderTelegramPreferenceSummary,
  telegramPreferenceSubjectId,
} from './telegram-preferences.js';
import type {
  TelegramNaturalLanguageClarificationReport,
} from './natural-language-clarification.js';
import type {
  TelegramNaturalLanguageParsedIntent,
} from './natural-language-intents.js';

type TelegramChat = {
  id: number | string;
  type?: string;
};

type TelegramFrom = {
  id: number;
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramFrom;
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramFrom;
  message?: TelegramMessage;
  data?: string;
};

type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export type TelegramRunnerOptions = {
  dryRun?: boolean;
};

const publicSafeCommands = new Set(['start', 'menu', 'help']);
let webhookUpdateQueue: Promise<void> = Promise.resolve();

const POLLING_TIMEOUT_SECONDS = 30;
const TELEGRAM_API_TIMEOUT_MS = 45_000;
const POLLING_HEARTBEAT_MS = 5 * 60 * 1000;
const POLLING_MAX_BACKOFF_MS = 30_000;
const TELEGRAM_SAFE_MESSAGE_LENGTH = 3_800;
const execFileAsync = promisify(execFile);

function personalSafetyLine(): string {
  return 'Safety: this is a personal, non-custodial SmartCup agent. It never needs your mnemonic, private key, seed phrase, browser session, or wallet JSON. You keep custody, verify recommendations, and approve wallet actions explicitly.';
}

function adminSafetyLine(): string {
  return personalSafetyLine();
}
const TELEGRAM_PUBLIC_COMMANDS = [
  { command: 'start', description: 'Start SmartCup agent' },
  { command: 'menu', description: 'Open guided SmartPredictor menu' },
  { command: 'help', description: 'Show commands and safety rules' },
  { command: 'agent_status', description: 'Show wallet and tournament status' },
  { command: 'freebet', description: 'Check freebet status' },
  { command: 'claim_status', description: 'Check claimable rewards' },
  { command: 'risk', description: 'Show or set prediction risk' },
  { command: 'objective', description: 'Show or set simulation objective' },
  { command: 'strategy', description: 'Show or set strategy posture' },
] as const;

type WizardRisk = RiskMode;
type PersonalMatchAction = 'decision' | 'simulation' | 'timing' | 'position' | 'alternatives';
type PreferenceDefaultsSubject = 'risk' | 'objective' | 'strategy';
type WizardStep =
  | 'awaiting_tournament_selection'
  | 'awaiting_risk'
  | 'awaiting_match'
  | 'awaiting_selected'
  | 'awaiting_freebet_wallet'
  | 'awaiting_approval_stake_usd'
  | 'awaiting_match_pick_home_score'
  | 'awaiting_match_pick_away_score'
  | 'awaiting_match_pick_penalty_winner'
  | 'confirming';

type WizardSession = {
  step: WizardStep;
  tournamentId?: string;
  tournamentName?: string;
  risk?: WizardRisk;
  matchId?: string;
  selectedMatchIds?: string[];
  matchPickDraftId?: string;
  approvalDecisionId?: string;
};

type PodiumApprovalDraft = {
  id: string;
  createdAt: string;
  chatId: string;
  userId: string;
  tournamentId: string;
  report: PodiumStrategyReport;
  selection: PodiumSelection;
  valuePlanck: U128String;
  valueLabel: string;
};

type PodiumPositionKey = 'champion' | 'runnerUp' | 'thirdPlace';

type PodiumSelection = Record<PodiumPositionKey, string>;

type MatchPickDraft = {
  id: string;
  createdAt: string;
  chatId: string;
  userId: string;
  decision: DecisionReport;
  selectedScore: Score;
  selectedPenaltyWinner: PenaltyWinner | null;
};

type ApprovalValueDraft = {
  id: string;
  createdAt: string;
  chatId: string;
  userId: string;
  decisionId: string;
  valuePlanck: U128String;
  valueLabel: string;
  stakeUsd: string;
};

const wizardSessions = new Map<string, WizardSession>();
const podiumApprovalDrafts = new Map<string, PodiumApprovalDraft>();
const matchPickDrafts = new Map<string, MatchPickDraft>();
const approvalValueDrafts = new Map<string, ApprovalValueDraft>();
const PODIUM_APPROVAL_DRAFT_TTL_MS = 30 * 60 * 1000;
const PODIUM_TEAM_PAGE_SIZE = 12;
const MATCH_PICK_DRAFT_TTL_MS = 30 * 60 * 1000;
const MATCH_PICK_MAX_GOALS = 5;
const APPROVAL_VALUE_DRAFT_TTL_MS = 30 * 60 * 1000;

export async function runTelegramBot(config: AgentConfig, options: TelegramRunnerOptions = {}): Promise<void> {
  assertReusableProductionSetup(config);

  if (options.dryRun) {
    printTelegramDryRun(config);
    return;
  }

  if (!config.telegram.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required to run the Telegram bot.');
  }

  if (config.telegram.mode === 'webhook') {
    await runWebhook(config);
    return;
  }

  await runPolling(config);
}

async function runPolling(config: AgentConfig): Promise<void> {
  console.log(`Starting ${config.telegram.publicBotName} Telegram polling mode.`);
  console.log(`Admin ids configured: ${config.telegram.adminIds.length}`);
  await syncTelegramPublicCommands(config);
  let offset = 0;
  let consecutiveFailures = 0;
  let lastHeartbeatAt = Date.now();
  let lastPredictionAlertScanAt = 0;
  let predictionAlertScanInFlight = false;
  let processedUpdates = 0;
  let shutdownRequested = false;

  const requestShutdown = (signal: string) => {
    shutdownRequested = true;
    console.log(`Telegram polling shutdown requested by ${signal}.`);
  };
  process.once('SIGINT', () => requestShutdown('SIGINT'));
  process.once('SIGTERM', () => requestShutdown('SIGTERM'));

  while (!shutdownRequested) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>(config, 'getUpdates', {
        timeout: POLLING_TIMEOUT_SECONDS,
        offset,
        allowed_updates: ['message', 'callback_query'],
      });

      consecutiveFailures = 0;
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          await handleTelegramUpdate(config, update);
          processedUpdates += 1;
        } catch (error) {
          console.error(`Telegram update ${update.update_id} failed; continuing polling:`, error);
        }
      }

      const now = Date.now();
      if (shouldRunPredictionAlertScan(config, now, lastPredictionAlertScanAt) && !predictionAlertScanInFlight) {
        lastPredictionAlertScanAt = now;
        predictionAlertScanInFlight = true;
        void runPredictionAlertScan(config)
          .catch((error) => {
            console.error('Telegram prediction alert scan failed; continuing polling:', error);
          })
          .finally(() => {
            predictionAlertScanInFlight = false;
          });
      }

      if (now - lastHeartbeatAt >= POLLING_HEARTBEAT_MS) {
        console.log(
          `Telegram polling heartbeat: offset=${offset}, processedUpdates=${processedUpdates}, lastBatch=${updates.length}`,
        );
        lastHeartbeatAt = now;
      }
    } catch (error) {
      consecutiveFailures += 1;
      const backoffMs = pollingBackoffMs(consecutiveFailures);
      console.error(
        `Telegram polling failure #${consecutiveFailures}; retrying in ${backoffMs}ms:`,
        error,
      );
      await sleep(backoffMs);
    }
  }

  console.log(`Telegram polling stopped: offset=${offset}, processedUpdates=${processedUpdates}.`);
}

async function runWebhook(config: AgentConfig): Promise<void> {
  if (!config.telegram.webhookUrl) throw new Error('TELEGRAM_WEBHOOK_URL is required in webhook mode.');

  await syncTelegramPublicCommands(config);
  await telegramApi(config, 'setWebhook', {
    url: config.telegram.webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    ...(config.telegram.webhookSecret ? { secret_token: config.telegram.webhookSecret } : {}),
  });

  const server = createServer((req, res) => {
    void handleWebhookRequest(config, req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(config.telegram.webhookPort, config.telegram.webhookHost, resolve);
  });

  console.log(
    `Telegram webhook server listening on ${config.telegram.webhookHost}:${config.telegram.webhookPort}`,
  );
  console.log(`Webhook URL registered: ${config.telegram.webhookUrl}`);
  startPredictionAlertScheduler(config);
}

async function handleWebhookRequest(
  config: AgentConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  if (config.telegram.webhookSecret) {
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== config.telegram.webhookSecret) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid_secret' }));
      return;
    }
  }

  try {
    const raw = await readRequestBody(req);
    const update = JSON.parse(raw) as TelegramUpdate;
    await enqueueWebhookUpdate(() => handleTelegramUpdate(config, update));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error('Telegram webhook update failed:', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'update_failed' }));
  }
}

async function handleTelegramUpdate(config: AgentConfig, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    console.log(`Telegram callback received: ${update.callback_query.data ?? 'no_data'}`);
    await handleTelegramCallback(config, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.text) return;
  const text = message.text.trim();
  const route = resolveTelegramMessageRoute(text, {
    hasWizardSession: wizardSessions.has(wizardKey(message.chat.id, message.from)),
  });

  if (route.kind === 'wizard_text') {
    await handleWizardText(config, message, text);
    return;
  }

  if (route.kind === 'natural_language') {
    await handleNaturalLanguageFallback(config, message);
    return;
  }

  const command = route.command;
  console.log(`Telegram command received: /${command}`);
  if (message.chat.type && message.chat.type !== 'private' && !publicSafeCommands.has(command)) {
    await telegramApi(config, 'sendMessage', {
      chat_id: message.chat.id,
      text: [
        `For safety, /${command} is available only in a private DM with ${config.telegram.publicBotName}.`,
        'Operator actions and wallet-related checks must stay in private chat.',
        personalSafetyLine(),
      ].join('\n'),
      disable_web_page_preview: true,
    });
    return;
  }

  const user = telegramUserContext(message.from);
  if (command === 'menu') {
    wizardSessions.delete(wizardKey(message.chat.id, message.from));
    await sendTournamentSelector(config, message.chat.id, message.from);
    return;
  }
  if (command === 'operator_decide' || command === 'operator_simulate' || command === 'operator_approve' || command === 'operator_policy') {
    const response = await handleTelegramOperatorCommand({
      command,
      text,
      user,
      config,
    });
    await sendTelegramLongMessage(
      config,
      message.chat.id,
      response.text,
      command === 'operator_decide' && response.decisionId ? renderOperatorApprovalKeyboard(response.decisionId) : undefined,
    );
    return;
  }
  const memory = new MemoryStore();
  const reply = await routeTelegramCommand({
    config,
    command,
    text,
    user,
    memory,
    selectedTournamentId: selectedTournamentIdForMessage(message),
  });
  if (!reply) return;

  await sendTelegramMessage(config, message.chat.id, reply);
}

async function handleNaturalLanguageFallback(config: AgentConfig, message: TelegramMessage): Promise<void> {
  if (message.chat.type && message.chat.type !== 'private') return;
  const parsed = parseTelegramNaturalLanguage(message.text ?? '', {
    tournaments: await listTournamentProfileOptions(config.artifacts.tournamentProfilePath).then((profiles) =>
      profiles.map((profile) => ({
        id: profile.tournamentId,
        name: profile.name,
        slug: profile.slug,
        aliases: [profile.tournamentId, profile.name, profile.slug],
      })),
    ),
  });
  const clarification = buildTelegramNaturalLanguageClarification(parsed);

  if (await routeTelegramNaturalLanguageUserIntent(config, message, parsed, clarification)) {
    return;
  }

  if (await routeTelegramNaturalLanguageOperatorIntent(config, message, parsed, clarification)) {
    return;
  }

  const slotLines = Object.entries(parsed.slots)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);
  const clarificationLines = [
    ...clarification.blockingPrompts.map((prompt) => `- ${prompt}`),
    ...clarification.advisoryPrompts.map((prompt) => `- ${prompt}`),
  ];
  saveNaturalLanguageTelemetry(message, parsed, 'parser_preview', 'no_action', {
    clarificationPrompts: clarificationLines.length,
  });
  await sendTelegramMessage(
    config,
    message.chat.id,
    [
      'Natural-language parser MVP',
      `Intent: ${parsed.intent}`,
      `Confidence: ${parsed.confidence}`,
      `Safety: ${parsed.safety}`,
      `Permission: ${parsed.permission}`,
      parsed.missingRequiredSlots.length > 0
        ? `Missing: ${parsed.missingRequiredSlots.join(', ')}`
        : 'Missing: none',
      parsed.ambiguousSlots.length > 0
        ? `Ambiguous: ${parsed.ambiguousSlots.join(', ')}`
        : 'Ambiguous: none',
      slotLines.length > 0 ? ['Slots:', ...slotLines.map((line) => `- ${line}`)].join('\n') : 'Slots: none',
      clarificationLines.length > 0
        ? ['Clarification:', ...clarificationLines].join('\n')
        : `Clarification: ${clarification.primaryPrompt ?? 'none'}`,
      '',
      'Natural-language routing is not active yet. Use /menu or exact commands to take action.',
      'Slash commands always take priority over natural-language parsing.',
      personalSafetyLine(),
    ].join('\n'),
  );
}

async function routeTelegramNaturalLanguageUserIntent(
  config: AgentConfig,
  message: TelegramMessage,
  parsed: TelegramNaturalLanguageParsedIntent,
  clarification: TelegramNaturalLanguageClarificationReport,
): Promise<boolean> {
  if (parsed.permission !== 'user') return false;
  const user = telegramUserContext(message.from);
  const memory = new MemoryStore();

  if (parsed.intent === 'unknown') return false;

  if (clarification.requiresClarification) {
    saveNaturalLanguageTelemetry(message, parsed, 'clarification_prompt', 'clarification_required', {
      blockingPrompts: clarification.blockingPrompts.length,
      advisoryPrompts: clarification.advisoryPrompts.length,
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      renderNaturalLanguageClarificationMessage(parsed, clarification),
undefined,
    );
    return true;
  }

  if (parsed.intent === 'help') {
    saveNaturalLanguageTelemetry(message, parsed, 'user_help', 'read_only');
    await sendTelegramMessage(config, message.chat.id, renderHelp());
    return true;
  }

  if (parsed.intent === 'agent_status') {
    const tournament = await resolveNaturalLanguageTournament(
      config,
      parsed,
      selectedTournamentIdForMessage(message),
    );
    saveNaturalLanguageTelemetry(message, parsed, 'user_agent_status', 'read_only', {
      tournamentId: tournament?.tournamentId ?? null,
    });
    await sendTelegramMessage(config, message.chat.id, await renderAgentTournamentStatus(config, tournament));
    return true;
  }

  if (parsed.intent === 'strategy_preferences') {
    const command = preferenceCommandFromNaturalLanguage(message.text ?? '', parsed);
    const response = await handleTelegramPreferenceCommand({
      config,
      command,
      text: buildNaturalLanguagePreferenceCommandText(command, message.text ?? '', parsed),
      user,
      memory,
      selectedTournamentId: selectedTournamentIdForMessage(message),
    });
    saveNaturalLanguageTelemetry(
      message,
      parsed,
      'user_strategy_preferences',
      parsed.slots.riskMode ? 'local_preference_stored' : 'read_only',
      {
        command,
        riskMode: parsed.slots.riskMode ?? null,
      },
    );
    await sendTelegramMessage(config, message.chat.id, response);
    return true;
  }

  if (parsed.intent === 'tournament_select') {
    const tournament = await resolveNaturalLanguageTournament(config, parsed);
    if (!tournament) {
      saveNaturalLanguageTelemetry(message, parsed, 'user_tournament_select', 'blocked', {
        reason: 'tournament_not_found',
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        'I could not find that tournament profile. Use /menu to choose from configured tournaments.',
      );
      return true;
    }
    wizardSessions.set(wizardKey(message.chat.id, message.from), {
      step: 'awaiting_tournament_selection',
      tournamentId: tournament.tournamentId,
      tournamentName: tournament.name,
    });
    saveNaturalLanguageTelemetry(message, parsed, 'user_tournament_select', 'read_only', {
      tournamentId: tournament.tournamentId,
    });
    await sendTelegramMessage(config, message.chat.id, renderProductMenuText(tournament), renderProductMenuKeyboard());
    return true;
  }

  if (parsed.intent === 'eligible_matches') {
    saveNaturalLanguageTelemetry(message, parsed, 'user_eligible_matches', 'read_only', {
      matchScope: parsed.slots.matchScope ?? null,
    });
    await sendNaturalLanguageEligibleMatches(config, message.chat.id, parsed);
    return true;
  }

  if (parsed.intent === 'freebet_status') {
    const wallet = (parsed.slots.publicWallet as ActorId | undefined) ?? config.wallet.hexAddress;
    const report = await buildFreebetStatusReport(config, { wallet });
    saveNaturalLanguageTelemetry(message, parsed, 'user_freebet_status', 'read_only', {
      walletHash: hashNullable(wallet),
      warnings: report.warnings.length,
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      [renderFriendlyFreebetStatus(report), personalSafetyLine()].join('\n\n'),
    );
    return true;
  }

  if (parsed.intent === 'refund_status') {
    if (isClaimExecutionRequest(message.text ?? '')) {
      await sendClaimPendingPlan(config, message.chat.id, user);
      saveNaturalLanguageTelemetry(message, parsed, 'operator_claim_pending', 'explicit_button_required', {
        walletHash: hashNullable(config.wallet.hexAddress),
      });
      return true;
    }

    const wallet = (parsed.slots.publicWallet as ActorId | undefined) ?? config.wallet.hexAddress;
    const report = await buildRefundStatusReport(config, { wallet });
    saveNaturalLanguageTelemetry(message, parsed, 'user_refund_status', 'read_only', {
      walletHash: hashNullable(wallet),
      warnings: report.warnings.length,
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      [renderFriendlyRefundStatus(report), personalSafetyLine()].join('\n\n'),
    );
    return true;
  }

  return false;
}

async function routeTelegramNaturalLanguageOperatorIntent(
  config: AgentConfig,
  message: TelegramMessage,
  parsed: TelegramNaturalLanguageParsedIntent,
  clarification: TelegramNaturalLanguageClarificationReport,
): Promise<boolean> {
  if (parsed.permission !== 'operator') return false;
  let routedParsed = parsed;
  let routedClarification = clarification;
  const user = telegramUserContext(message.from);
  const permission = new TelegramPermissionModel(config).canRun(naturalLanguageOperatorCommand(parsed), user);
  if (!permission.allowed) {
    saveNaturalLanguageTelemetry(message, parsed, 'permission_denied', 'permission_denied', {
      reason: permission.reason,
      command: naturalLanguageOperatorCommand(parsed),
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        'Operator natural-language command denied.',
        `Intent: ${parsed.intent}`,
        `Reason: ${permission.reason}`,
        adminSafetyLine(),
      ].join('\n'),
    );
    return true;
  }

  if (
    (parsed.intent === 'decision_preview' ||
      parsed.intent === 'leaderboard_analysis' ||
      parsed.intent === 'market_analysis' ||
      parsed.intent === 'timing_strategy' ||
      parsed.intent === 'crowd_contrarian_map' ||
      parsed.intent === 'football_context_risk' ||
      parsed.intent === 'tournament_position_strategy' ||
      parsed.intent === 'alternative_pick_set') &&
    !parsed.slots.matchId &&
    parsed.slots.matchScope === 'next_open_match'
  ) {
    const tournament = await resolveNaturalLanguageTournament(config, parsed);
    const resolved = await resolveNaturalLanguageMatchScopeForOperator(config, message.chat.id, parsed, tournament);
    if (!resolved) return true;
    routedParsed = resolved;
    routedClarification = buildTelegramNaturalLanguageClarification(routedParsed);
  }

  if (routedClarification.requiresClarification) {
    saveNaturalLanguageTelemetry(message, routedParsed, 'clarification_prompt', 'clarification_required', {
      blockingPrompts: routedClarification.blockingPrompts.length,
      advisoryPrompts: routedClarification.advisoryPrompts.length,
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      renderNaturalLanguageClarificationMessage(routedParsed, routedClarification),
    );
    return true;
  }

  if (
    routedParsed.intent === 'decision_preview' ||
    routedParsed.intent === 'market_analysis' ||
    routedParsed.intent === 'timing_strategy' ||
    routedParsed.intent === 'crowd_contrarian_map' ||
    routedParsed.intent === 'football_context_risk' ||
    routedParsed.intent === 'tournament_position_strategy' ||
    routedParsed.intent === 'alternative_pick_set'
  ) {
    const memory = new MemoryStore();
    const commandText = await applyOperatorPreferencesToCommandText({
      config,
      memory,
      user,
      text: buildNaturalLanguageOperatorCommandText('operator_decide', routedParsed),
      command: 'operator_decide',
      selectedTournamentId: selectedTournamentIdForMessage(message),
    });
    const response = await handleTelegramOperatorCommand({
      command: 'operator_decide',
      text: commandText,
      user,
      config,
    });
    saveNaturalLanguageTelemetry(
      message,
      routedParsed,
      routedParsed.intent === 'market_analysis'
        ? 'operator_market_analysis'
        : routedParsed.intent === 'timing_strategy'
          ? 'operator_timing_strategy'
          : routedParsed.intent === 'crowd_contrarian_map'
            ? 'operator_crowd_contrarian_map'
            : routedParsed.intent === 'football_context_risk'
              ? 'operator_football_context_risk'
              : routedParsed.intent === 'tournament_position_strategy'
                ? 'operator_tournament_position_strategy'
                : routedParsed.intent === 'alternative_pick_set'
                  ? 'operator_alternative_pick_set'
          : 'operator_decision_preview',
      response.decisionId ? 'decision_preview_saved' : 'blocked',
      {
        ok: response.ok,
        decisionId: response.decisionId ?? null,
        marketFocused: routedParsed.intent === 'market_analysis',
        timingFocused: routedParsed.intent === 'timing_strategy',
        crowdFocused: routedParsed.intent === 'crowd_contrarian_map',
        footballContextFocused: routedParsed.intent === 'football_context_risk',
        tournamentPositionFocused: routedParsed.intent === 'tournament_position_strategy',
        alternativePickSetFocused: routedParsed.intent === 'alternative_pick_set',
      },
    );
    await sendTelegramLongMessage(
      config,
      message.chat.id,
      response.text,
      response.decisionId ? renderOperatorApprovalKeyboard(response.decisionId) : undefined,
    );
    return true;
  }

  if (routedParsed.intent === 'leaderboard_analysis') {
    const memory = new MemoryStore();
    const commandText = await applyOperatorPreferencesToCommandText({
      config,
      memory,
      user,
      text: buildNaturalLanguageOperatorCommandText('operator_simulate', routedParsed),
      command: 'operator_simulate',
      selectedTournamentId: selectedTournamentIdForMessage(message),
    });
    const response = await handleTelegramOperatorCommand({
      command: 'operator_simulate',
      text: commandText,
      user,
      config,
    });
    saveNaturalLanguageTelemetry(message, routedParsed, 'operator_leaderboard_analysis', response.ok ? 'read_only' : 'blocked', {
      ok: response.ok,
      matchId: routedParsed.slots.matchId ?? null,
    });
    await sendTelegramLongMessage(config, message.chat.id, response.text);
    return true;
  }

  if (routedParsed.intent === 'saved_reports') {
    const tournament = await resolveNaturalLanguageTournament(
      config,
      routedParsed,
      selectedTournamentIdForMessage(message),
    );
    if (!tournament) {
      saveNaturalLanguageTelemetry(message, routedParsed, 'clarification_prompt', 'clarification_required', {
        missing: 'tournamentId',
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'I need a tournament context before listing saved reports.',
          'Use /menu to choose a tournament, or say: show saved reports for World Cup.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return true;
    }
    saveNaturalLanguageTelemetry(message, routedParsed, 'operator_saved_reports', 'read_only', {
      tournamentId: tournament.tournamentId,
    });
    await sendPersonalSavedReportLookup(config, message.chat.id, message.from, tournament);
    return true;
  }

  if (
    routedParsed.intent === 'personal_bundle' ||
    routedParsed.intent === 'personal_podium_strategy' ||
    routedParsed.intent === 'personal_tournament_advisory' ||
    routedParsed.intent === 'calibration_report' ||
    routedParsed.intent === 'export_report'
  ) {
    const tournament = await resolveNaturalLanguageTournament(
      config,
      routedParsed,
      selectedTournamentIdForMessage(message),
    );
    if (!tournament) {
      saveNaturalLanguageTelemetry(message, routedParsed, 'clarification_prompt', 'clarification_required', {
        missing: 'tournamentId',
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'I need a tournament context before running that personal action.',
          'Use /menu to choose a tournament, or mention the tournament name in your message.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return true;
    }
    if (!message.from) {
      saveNaturalLanguageTelemetry(message, routedParsed, 'permission_denied', 'permission_denied', {
        reason: 'missing_telegram_user',
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        ['Personal operator action denied.', 'Reason: Telegram user id is missing.', adminSafetyLine()].join('\n'),
      );
      return true;
    }

    const actionTaken =
      routedParsed.intent === 'personal_bundle'
        ? 'operator_personal_bundle'
        : routedParsed.intent === 'personal_podium_strategy'
          ? 'operator_personal_podium_strategy'
          : routedParsed.intent === 'personal_tournament_advisory'
            ? 'operator_personal_tournament_advisory'
            : routedParsed.intent === 'calibration_report'
              ? 'operator_calibration_report'
              : 'operator_export_report';
    saveNaturalLanguageTelemetry(message, routedParsed, actionTaken, 'read_only', {
      tournamentId: tournament.tournamentId,
    });

    if (routedParsed.intent === 'personal_bundle') {
      await runPersonalBundle(config, message.chat.id, message.from, tournament);
      return true;
    }
    if (routedParsed.intent === 'personal_podium_strategy') {
      await runPersonalPodiumStrategy(config, message.chat.id, message.from, tournament);
      return true;
    }
    if (routedParsed.intent === 'personal_tournament_advisory') {
      await runPersonalTournamentAdvisory(config, message.chat.id, message.from, tournament);
      return true;
    }
    if (routedParsed.intent === 'calibration_report') {
      await sendPostMatchCalibrationReport(config, message.chat.id, message.from, tournament);
      return true;
    }

    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        'Export Report',
        `Tournament: ${tournament.name}`,
        `Tournament ID: ${tournament.tournamentId}`,
        '',
        'Choose an export format for the latest saved personal DecisionReports.',
        'Exports are read-only and do not submit transactions.',
        adminSafetyLine(),
      ].join('\n'),
      renderExportReportKeyboard(),
    );
    return true;
  }

  if (routedParsed.intent === 'operator_policy') {
    const response = await handleTelegramOperatorCommand({
      command: 'operator_policy',
      text: buildNaturalLanguageOperatorCommandText('operator_policy', routedParsed),
      user,
      config,
    });
    saveNaturalLanguageTelemetry(message, routedParsed, 'operator_policy', 'policy_change', {
      ok: response.ok,
      policyMode: routedParsed.slots.policyMode ?? null,
    });
    await sendTelegramMessage(config, message.chat.id, response.text, renderPolicyKeyboard());
    return true;
  }

  if (routedParsed.intent === 'approve_plan') {
    if (!routedParsed.slots.decisionId) {
      saveNaturalLanguageTelemetry(message, routedParsed, 'clarification_prompt', 'clarification_required', {
        missing: 'decisionId',
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        renderNaturalLanguageClarificationMessage(parsed, {
          requiresClarification: true,
          blockingPrompts: ['Which saved decision id should I approve? Example: decision-3-balanced-2-1-1780502534986.'],
          advisoryPrompts: [],
          primaryPrompt: 'Which saved decision id should I approve?',
        }),
      );
      return true;
    }

    if (!savedDecisionExists(routedParsed.slots.decisionId)) {
      saveNaturalLanguageTelemetry(message, routedParsed, 'operator_approval_rejected', 'blocked', {
        reason: 'decision_not_found',
        decisionId: routedParsed.slots.decisionId,
      });
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'Operator approval rejected.',
          `Decision not found in local memory: ${routedParsed.slots.decisionId}`,
          '',
          'Natural-language approval can only continue for an existing saved DecisionReport.',
          'Generate a fresh preview first, then use the Approve Plan button returned by that preview.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return true;
    }

    saveNaturalLanguageTelemetry(message, routedParsed, 'operator_approval_button_rendered', 'explicit_button_required', {
      decisionId: routedParsed.slots.decisionId,
    });
    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        'Operator approval intent recognized.',
        `Decision: ${routedParsed.slots.decisionId}`,
        '',
        'For safety, natural language does not execute wallet transactions directly.',
        'Tap Approve Plan below to use the existing explicit approval handler.',
        adminSafetyLine(),
      ].join('\n'),
      renderOperatorApprovalKeyboard(routedParsed.slots.decisionId),
    );
    return true;
  }

  return false;
}

function naturalLanguageOperatorCommand(
  parsed: TelegramNaturalLanguageParsedIntent,
): 'operator_decide' | 'operator_simulate' | 'operator_approve' | 'operator_policy' {
  if (parsed.intent === 'operator_policy') return 'operator_policy';
  if (parsed.intent === 'approve_plan') return 'operator_approve';
  if (parsed.intent === 'leaderboard_analysis') return 'operator_simulate';
  if (parsed.intent === 'market_analysis') return 'operator_decide';
  if (parsed.intent === 'timing_strategy') return 'operator_decide';
  if (parsed.intent === 'crowd_contrarian_map') return 'operator_decide';
  if (parsed.intent === 'football_context_risk') return 'operator_decide';
  if (parsed.intent === 'tournament_position_strategy') return 'operator_decide';
  if (parsed.intent === 'alternative_pick_set') return 'operator_decide';
  if (parsed.intent === 'saved_reports') return 'operator_decide';
  if (parsed.intent === 'personal_bundle') return 'operator_decide';
  if (parsed.intent === 'personal_podium_strategy') return 'operator_decide';
  if (parsed.intent === 'personal_tournament_advisory') return 'operator_simulate';
  if (parsed.intent === 'calibration_report') return 'operator_decide';
  if (parsed.intent === 'export_report') return 'operator_decide';
  return 'operator_decide';
}

function buildNaturalLanguageOperatorCommandText(
  command: 'operator_decide' | 'operator_simulate' | 'operator_policy',
  parsed: TelegramNaturalLanguageParsedIntent,
): string {
  if (command === 'operator_policy') {
    return [
      '/operator_policy',
      parsed.slots.policyMode ? `mode:${parsed.slots.policyMode}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ');
  }

  return [
    command === 'operator_simulate' ? '/operator_simulate' : '/operator_decide',
    parsed.slots.matchId ? `match:${parsed.slots.matchId}` : null,
    parsed.slots.riskMode
      ? command === 'operator_simulate'
        ? `objective:${parsed.slots.riskMode}`
        : `risk:${parsed.slots.riskMode}`
      : null,
    parsed.slots.fundingSource ? `funding:${parsed.slots.fundingSource}` : null,
    parsed.slots.stakeUsd ? `stakeUsd:${parsed.slots.stakeUsd}` : null,
    parsed.slots.stakePlanck ? `stakePlanck:${parsed.slots.stakePlanck}` : null,
    parsed.intent === 'market_analysis' ? 'focus:market' : null,
    parsed.intent === 'crowd_contrarian_map' ? 'focus:crowd' : null,
    parsed.intent === 'football_context_risk' ? 'focus:context' : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function renderNaturalLanguageClarificationMessage(
  parsed: TelegramNaturalLanguageParsedIntent,
  clarification: TelegramNaturalLanguageClarificationReport,
): string {
  const prompts = [
    ...clarification.blockingPrompts,
    ...clarification.advisoryPrompts,
  ];
  return [
    'I need one more detail before I can route that safely.',
    `Intent: ${parsed.intent}`,
    '',
    ...prompts.map((prompt) => `- ${prompt}`),
    '',
    'You can also use /menu for guided buttons.',
    personalSafetyLine(),
  ].join('\n');
}

function renderNaturalLanguageStartKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Open Guided Menu', callback_data: 'sp:menu' }],
      [{ text: 'Agent Status', callback_data: 'sp:agent_status' }],
    ],
  };
}

async function resolveNaturalLanguageTournament(
  config: AgentConfig,
  parsed: TelegramNaturalLanguageParsedIntent,
  selectedTournamentId?: string,
): Promise<TournamentProfileOption | null> {
  if (parsed.slots.tournamentId) {
    return findTournamentOption(config, parsed.slots.tournamentId);
  }
  if (selectedTournamentId) {
    const selectedTournament = await findTournamentOption(config, selectedTournamentId);
    if (selectedTournament) return selectedTournament;
  }
  return findActiveTournamentOption(config);
}

function selectedTournamentIdForMessage(message: TelegramMessage): string | undefined {
  return wizardSessions.get(wizardKey(message.chat.id, message.from))?.tournamentId;
}

async function sendNaturalLanguageEligibleMatches(
  config: AgentConfig,
  chatId: number | string,
  parsed: TelegramNaturalLanguageParsedIntent,
): Promise<void> {
  const tournament = await resolveNaturalLanguageTournament(config, parsed);
  if (!tournament) {
    await sendTelegramMessage(config, chatId, 'No tournament profile is configured yet. Use /menu after adding a profile.');
    return;
  }

  try {
    const limit = parsed.slots.matchScope === 'next_five_open_matches' ? 5 : 10;
    const picker = await buildEligibleMatchPicker(config, tournament, limit);
    await sendTelegramMessage(
      config,
      chatId,
      [
        `Eligible matches for ${tournament.name}`,
        `Tournament ID: ${tournament.tournamentId}`,
        `Showing ${picker.matches.length} of ${picker.totalEligible} eligible matches.`,
        ...renderPickerWarningLines(picker.warnings),
        '',
        picker.matches.length === 0
          ? 'No eligible open matches found.'
          : picker.matches.map(renderEligibleMatchLine).join('\n'),
        '',
        'Use /menu to open personal prediction tools with guided match buttons.',
        personalSafetyLine(),
      ].join('\n'),
    );
  } catch (error) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        renderFriendlySourceFallback({
          title: 'Eligible matches are temporarily unavailable',
          rawMessages: [error instanceof Error ? error.message : String(error)],
          impact: 'The agent could not build the live open-match list right now.',
          fallbackAction: 'Use /menu later, or request a personal prediction with a specific SmartCup match id.',
        }),
        personalSafetyLine(),
      ].join('\n\n'),
    );
  }
}

async function resolveNaturalLanguageMatchScopeForOperator(
  config: AgentConfig,
  chatId: number | string,
  parsed: TelegramNaturalLanguageParsedIntent,
  tournament: TournamentProfileOption | null,
): Promise<TelegramNaturalLanguageParsedIntent | null> {
  if (parsed.slots.matchId) return parsed;
  if (parsed.slots.matchScope !== 'next_open_match') return parsed;
  if (!tournament) {
    await sendTelegramMessage(config, chatId, 'No tournament profile is configured yet. Use /menu after adding a profile.');
    return null;
  }

  const picker = await safeBuildEligibleMatchPicker(config, tournament, 1, chatId, true);
  if (!picker) return null;
  const match = picker.matches[0];
  if (!match) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        `No eligible next open match found for ${tournament.name}.`,
        'Decision preview cannot continue without a provably eligible open match.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return null;
  }

  await sendTelegramMessage(
    config,
    chatId,
    [
      `Resolved next open match for ${tournament.name}:`,
      renderEligibleMatchLine(match),
      '',
      parsed.intent === 'leaderboard_analysis'
        ? 'Running read-only competitor and leaderboard simulation now.'
        : parsed.intent === 'market_analysis'
          ? 'Generating saved decision preview with market/odds comparison now.'
          : parsed.intent === 'timing_strategy'
            ? 'Generating saved decision preview with timing strategy now.'
            : parsed.intent === 'crowd_contrarian_map'
              ? 'Generating saved decision preview with crowd contrarian map now.'
              : parsed.intent === 'football_context_risk'
                ? 'Generating saved decision preview with lineup/injury/news risk now.'
                : parsed.intent === 'tournament_position_strategy'
                  ? 'Generating saved decision preview with tournament-position strategy now.'
                  : parsed.intent === 'alternative_pick_set'
                    ? 'Generating saved decision preview with alternative pick set now.'
        : 'Generating saved decision preview now.',
      adminSafetyLine(),
    ].join('\n'),
  );
  return withResolvedMatch(parsed, match.matchId);
}

async function safeBuildEligibleMatchPicker(
  config: AgentConfig,
  tournament: TournamentProfileOption,
  limit: number,
  chatId: number | string,
  operatorOnly: boolean,
): Promise<Awaited<ReturnType<typeof buildEligibleMatchPicker>> | null> {
  try {
    return await buildEligibleMatchPicker(config, tournament, limit);
  } catch (error) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        renderFriendlySourceFallback({
          title: 'Eligible matches are temporarily unavailable',
          rawMessages: [error instanceof Error ? error.message : String(error)],
          impact: 'The agent could not prove the next open match from live sources.',
          fallbackAction: operatorOnly
            ? 'Operator preview is blocked until the next open match can be proven.'
            : 'Use /menu later, or use an exact match id if you already know one.',
        }),
        operatorOnly ? adminSafetyLine() : personalSafetyLine(),
      ].join('\n\n'),
    );
    return null;
  }
}

function withResolvedMatch(
  parsed: TelegramNaturalLanguageParsedIntent,
  matchId: string,
): TelegramNaturalLanguageParsedIntent {
  return {
    ...parsed,
    slots: {
      ...parsed.slots,
      matchId,
      matchScope: 'single_match',
    },
    missingRequiredSlots: parsed.missingRequiredSlots.filter((slot) => slot !== 'matchId'),
  };
}

function preferenceCommandFromNaturalLanguage(
  text: string,
  parsed: TelegramNaturalLanguageParsedIntent,
): TelegramPreferenceCommand {
  const normalized = text.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\bobjective\b/.test(normalized)) return 'objective';
  if (/\b(strategy|posture|protect (my |the )?lead|final swing|big swing)\b/.test(normalized)) return 'strategy';
  if (/\brisk\b/.test(normalized)) return 'risk';
  if (parsed.slots.riskMode === 'protect_lead' || parsed.slots.riskMode === 'final_swing') return 'strategy';
  return 'risk';
}

function buildNaturalLanguagePreferenceCommandText(
  command: TelegramPreferenceCommand,
  rawText: string,
  parsed: TelegramNaturalLanguageParsedIntent,
): string {
  const normalized = rawText.toLowerCase().replace(/\s+/g, ' ').trim();
  const isShow = /\b(show|current|settings|status|what are|which are)\b/.test(normalized) && !parsed.slots.riskMode;
  const tournament = parsed.slots.tournamentId ? ` tournament:${parsed.slots.tournamentId}` : '';
  if (isShow || !parsed.slots.riskMode) return `/${command} show${tournament}`;
  return `/${command} set ${parsed.slots.riskMode}${tournament}`;
}

export async function applyOperatorPreferencesToCommandText(input: {
  config: AgentConfig;
  memory: MemoryStore;
  user: TelegramUserContext;
  text: string;
  command: 'operator_decide' | 'operator_simulate';
  selectedTournamentId?: string | undefined;
}): Promise<string> {
  const preference = await resolveTelegramPreferenceForUser({
    config: input.config,
    memory: input.memory,
    user: input.user,
    role: 'operator',
    text: input.text,
    selectedTournamentId: input.selectedTournamentId,
  });
  if (!preference) return input.text;

  if (input.command === 'operator_decide' && !hasCommandArg(input.text, 'risk')) {
    return appendCommandArg(input.text, 'risk', preference.defaultRiskMode);
  }
  if (
    input.command === 'operator_simulate' &&
    !hasCommandArg(input.text, 'objective') &&
    !hasCommandArg(input.text, 'risk')
  ) {
    return appendCommandArg(input.text, 'objective', preference.simulationObjective);
  }
  return input.text;
}

export async function resolveTelegramPreferenceForUser(input: {
  config: AgentConfig;
  memory: MemoryStore;
  user: TelegramUserContext;
  role: StoredTelegramPreference['role'];
  text: string;
  selectedTournamentId?: string | undefined;
}): Promise<StoredTelegramPreference | null> {
  const tournament = await resolvePreferenceTournament(input.config, input.text, input.selectedTournamentId);
  if (!tournament) return null;
  return input.memory.getTelegramPreference({
    subjectId: telegramPreferenceSubjectId(normalizeTelegramId(input.user.id)),
    tournamentId: tournament.tournamentId,
    role: input.role,
  });
}

function hasCommandArg(text: string, key: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(key)}\\s*[:=]`, 'i').test(text);
}

function appendCommandArg(text: string, key: string, value: string): string {
  return `${text.trim()} ${key}:${value}`.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toWizardRisk(riskMode: RiskMode | undefined): WizardRisk {
  return riskMode ?? 'balanced';
}

async function routeTelegramCommand(input: {
  config: AgentConfig;
  command: string;
  text: string;
  user: TelegramUserContext;
  memory: MemoryStore;
  selectedTournamentId?: string | undefined;
}): Promise<string | null> {
  if (input.command === 'freebet') {
    const permission = new TelegramPermissionModel(input.config).canRun(input.command, input.user);
    if (!permission.allowed) {
      return `Command denied.\nReason: ${permission.reason}`;
    }
    const wallet = parseTelegramWalletArg(input.text) ?? input.config.wallet.hexAddress;
    const report = await buildFreebetStatusReport(input.config, { wallet });
    return [renderFriendlyFreebetStatus(report), personalSafetyLine()].join('\n\n');
  }

  if (input.command === 'claim_status' || input.command === 'refund') {
    const permission = new TelegramPermissionModel(input.config).canRun(input.command, input.user);
    if (!permission.allowed) {
      return `Command denied.\nReason: ${permission.reason}`;
    }
    const wallet = parseTelegramWalletArg(input.text) ?? input.config.wallet.hexAddress;
    const report = await buildRefundStatusReport(input.config, { wallet });
    return [renderFriendlyRefundStatus(report), personalSafetyLine()].join('\n\n');
  }

  if (input.command === 'risk' || input.command === 'objective' || input.command === 'strategy') {
    return handleTelegramPreferenceCommand({
      config: input.config,
      command: input.command,
      text: input.text,
      user: input.user,
      memory: input.memory,
      selectedTournamentId: input.selectedTournamentId,
    });
  }

  if (
    input.command === 'operator_decide' ||
    input.command === 'operator_simulate' ||
    input.command === 'operator_approve' ||
    input.command === 'operator_policy'
  ) {
    const text =
      input.command === 'operator_decide' || input.command === 'operator_simulate'
        ? await applyOperatorPreferencesToCommandText({
            config: input.config,
            memory: input.memory,
            user: input.user,
            text: input.text,
            command: input.command,
            selectedTournamentId: input.selectedTournamentId,
          })
        : input.text;
    const response = await handleTelegramOperatorCommand({
      command: input.command,
      text,
      user: input.user,
      config: input.config,
    });
    return response.text;
  }

  if (input.command === 'start') return renderStart(input.config);
  if (input.command === 'menu') return null;
  if (input.command === 'agent_status') {
    return renderAgentTournamentStatus(input.config, await findActiveTournamentOption(input.config));
  }
  if (input.command === 'help') return renderHelp();

  return [
    `Unknown command: /${input.command}`,
    'Try /menu, /help, /agent_status, /risk show, or ask for a personal prediction preview.',
    personalSafetyLine(),
  ].join('\n');
}

type TelegramPreferenceCommand = 'risk' | 'objective' | 'strategy';

async function handleTelegramPreferenceCommand(input: {
  config: AgentConfig;
  command: TelegramPreferenceCommand;
  text: string;
  user: TelegramUserContext;
  memory: MemoryStore;
  selectedTournamentId?: string | undefined;
}): Promise<string> {
  const permission = new TelegramPermissionModel(input.config).canRun(input.command, input.user);
  if (!permission.allowed) {
    return `Command denied.\nReason: ${permission.reason}`;
  }

  const tournament = await resolvePreferenceTournament(input.config, input.text, input.selectedTournamentId);
  if (!tournament) {
    return [
      'No tournament profile is configured yet.',
      'Use /menu after adding a tournament profile.',
      personalSafetyLine(),
    ].join('\n');
  }

  const role: StoredTelegramPreference['role'] = permission.role === 'admin' ? 'operator' : 'user';
  const subjectId = telegramPreferenceSubjectId(normalizeTelegramId(input.user.id));
  const existing = input.memory.getTelegramPreference({
    subjectId,
    tournamentId: tournament.tournamentId,
    role,
  });
  const action = parsePreferenceCommandAction(input.command, input.text);

  if (action.kind === 'show') {
    const preference =
      existing ??
      defaultTelegramPreference({
        telegramUserId: input.user.id,
        tournamentId: tournament.tournamentId,
        role,
      });
    return renderPreferenceCommandResponse({
      title: 'Strategy preferences',
      tournament,
      preference,
      saved: Boolean(existing),
      changedField: null,
    });
  }

  if (!action.value) {
    return [
      `Missing value for /${input.command} set.`,
      `Use: /${input.command} set balanced`,
      `Allowed values: ${riskModeValues().join(', ')}`,
      personalSafetyLine(),
    ].join('\n');
  }

  const patch = preferencePatchForCommand(input.command, action.value);
  const preference = buildTelegramPreference({
    telegramUserId: input.user.id,
    tournamentId: tournament.tournamentId,
    role,
    existing,
    ...(patch ? { patch } : {}),
    updatedBy: 'slash_command',
    note: `Updated by /${input.command} ${action.value}.`,
    payload: {
      command: input.command,
      tournamentName: tournament.name,
    },
  });
  input.memory.saveTelegramPreference(preference);

  return renderPreferenceCommandResponse({
    title: 'Strategy preferences updated',
    tournament,
    preference,
    saved: true,
    changedField: input.command,
  });
}

async function resolvePreferenceTournament(
  config: AgentConfig,
  text: string,
  selectedTournamentId?: string,
): Promise<TournamentProfileOption | null> {
  const explicitTournament = text.match(/\btournament[:=]([A-Za-z0-9_.-]+)/i)?.[1];
  if (explicitTournament) {
    const tournament = await findTournamentOption(config, explicitTournament);
    if (tournament) return tournament;
  }
  if (selectedTournamentId) {
    const tournament = await findTournamentOption(config, selectedTournamentId);
    if (tournament) return tournament;
  }
  return findActiveTournamentOption(config);
}

function parsePreferenceCommandAction(
  command: TelegramPreferenceCommand,
  text: string,
): { kind: 'show' } | { kind: 'set'; value: RiskMode | null } {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const firstCommand = tokens[0] ? tokens[0].replace(/^\//, '').split('@')[0] : '';
  const body = firstCommand === command ? tokens.slice(1).join(' ') : tokens.join(' ');
  const normalized = body.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!normalized || /\b(show|status|current|settings|default)\b/.test(normalized)) return { kind: 'show' };

  const explicitValue =
    body.match(/\b(?:set|mode|value|risk|objective|strategy)[:=]([A-Za-z_-]+)/i)?.[1] ??
    body.match(/\bset\s+(.+)$/i)?.[1] ??
    body;
  return {
    kind: 'set',
    value: parsePreferenceRiskMode(explicitValue),
  };
}

function parsePreferenceRiskMode(value: string | null | undefined): RiskMode | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(conservative|safe|cautious)\b/.test(normalized)) return 'conservative';
  if (/\b(balanced|normal|default)\b/.test(normalized)) return 'balanced';
  if (/\b(contrarian|against the crowd|differentiated)\b/.test(normalized)) return 'contrarian';
  if (/\b(catch up|chasing)\b/.test(normalized)) return 'catch_up';
  if (/\b(protect (my |the )?lead|defend (my |the )?lead)\b/.test(normalized)) return 'protect_lead';
  if (/\b(final swing|big swing)\b/.test(normalized)) return 'final_swing';
  return null;
}

function preferencePatchForCommand(
  command: TelegramPreferenceCommand,
  value: RiskMode,
): Parameters<typeof buildTelegramPreference>[0]['patch'] {
  if (command === 'risk') return { defaultRiskMode: value };
  if (command === 'objective') return { simulationObjective: value };
  return { strategyPosture: value };
}

function renderPreferenceCommandResponse(input: {
  title: string;
  tournament: TournamentProfileOption;
  preference: StoredTelegramPreference;
  saved: boolean;
  changedField: TelegramPreferenceCommand | null;
}): string {
  const target =
    input.changedField === 'risk'
      ? `Default risk updated to ${input.preference.defaultRiskMode}.`
      : input.changedField === 'objective'
        ? `Simulation objective updated to ${input.preference.simulationObjective}.`
        : input.changedField === 'strategy'
          ? `Strategy posture updated to ${input.preference.strategyPosture}.`
          : null;
  return [
    input.title,
    `Tournament: ${input.tournament.name}`,
    `Tournament ID: ${input.tournament.tournamentId}`,
    input.saved ? 'Persistence: saved in local memory.' : 'Persistence: using defaults until you set a value.',
    target,
    '',
    renderTelegramPreferenceSummary(input.preference),
    '',
    'Commands:',
    '/risk show | /risk set contrarian',
    '/objective show | /objective set catch_up',
    '/strategy show | /strategy set protect_lead',
    personalSafetyLine(),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function riskModeValues(): RiskMode[] {
  return ['conservative', 'balanced', 'contrarian', 'catch_up', 'protect_lead', 'final_swing'];
}

async function handleTelegramCallback(config: AgentConfig, callback: TelegramCallbackQuery): Promise<void> {
  await telegramApi(config, 'answerCallbackQuery', { callback_query_id: callback.id });
  const chat = callback.message?.chat;
  if (!chat) return;
  if (chat.type && chat.type !== 'private') {
    await sendTelegramMessage(config, chat.id, [
      `For safety, guided actions are available only in a private DM with ${config.telegram.publicBotName}.`,
      personalSafetyLine(),
    ].join('\n'));
    return;
  }

  const data = callback.data ?? '';
  const key = wizardKey(chat.id, callback.from);
  const user = telegramUserContext(callback.from);
  const memory = new MemoryStore();

  if (data === 'sp:menu') {
    wizardSessions.delete(key);
    await sendTournamentSelector(config, chat.id, callback.from);
    return;
  }


  if (data.startsWith('sp:tournament:')) {
    const tournamentId = data.slice('sp:tournament:'.length);
    const tournament = await findTournamentOption(config, tournamentId);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Tournament not found in configured profiles. Use /menu to reload.');
      return;
    }
    wizardSessions.set(key, {
      step: 'awaiting_tournament_selection',
      tournamentId: tournament.tournamentId,
      tournamentName: tournament.name,
    });
    await sendTelegramMessage(config, chat.id, renderProductMenuText(tournament), renderProductMenuKeyboard());
    return;
  }

  if (data.startsWith('sp:section:')) {
    const section = normalizeMenuSection(data.slice('sp:section:'.length));
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    if (!section) {
      await sendTelegramMessage(config, chat.id, 'Menu section not recognized. Use /menu to start again.');
      return;
    }
    await sendTelegramMessage(
      config,
      chat.id,
      renderMenuSectionText(tournament, section),
      renderMenuSectionKeyboard(section),
    );
    return;
  }

  if (data === 'sp:agent_status') {
    const session = wizardSessions.get(key);
    const tournament = session?.tournamentId
      ? await findTournamentOption(config, session.tournamentId)
      : await findActiveTournamentOption(config);
    await sendTelegramMessage(config, chat.id, await renderAgentTournamentStatus(config, tournament));
    return;
  }

  if (data === 'sp:strategy_settings') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(
        config,
        chat.id,
        [
          'No tournament profile is configured yet.',
          'Use /menu after adding a tournament profile.',
          personalSafetyLine(),
        ].join('\n'),
      );
      return;
    }
    await sendStrategySettingsMenu(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:settings:tournament') {
    await sendTournamentSelector(config, chat.id, callback.from);
    return;
  }

  if (data.startsWith('sp:settings:defaults:')) {
    const subject = data.slice('sp:settings:defaults:'.length);
    if (!isPreferenceDefaultsSubject(subject)) {
      await sendTelegramMessage(config, chat.id, 'Settings action not recognized. Use /menu to start again.');
      return;
    }
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPreferenceDefaultsMenu(config, chat.id, callback.from, tournament, subject);
    return;
  }

  if (data === 'sp:data_provider_status') {
    await sendTelegramMessage(config, chat.id, renderFriendlyDataProviderStatus(config));
    return;
  }

  if (data.startsWith('sp:strategy_analysis:')) {
    const action = data.slice('sp:strategy_analysis:'.length);
    if (!isPersonalStrategyAction(action)) {
      await sendTelegramMessage(config, chat.id, 'Strategy analysis action not recognized. Use /menu to start again.');
      return;
    }
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPersonalEligibleMatchPicker(config, chat.id, tournament, action);
    return;
  }

  if (data.startsWith('sp:pref:')) {
    const [, , command, value] = data.split(':');
    if (!isTelegramPreferenceCommand(command) || typeof value !== 'string' || !isWizardRisk(value)) {
      await sendTelegramMessage(config, chat.id, [
        'Strategy setting was not recognized.',
        'Use /menu and open Risk / Strategy Settings again.',
        personalSafetyLine(),
      ].join('\n'));
      return;
    }

    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, [
        'No tournament profile is configured yet.',
        'Use /menu after adding a tournament profile.',
        personalSafetyLine(),
      ].join('\n'));
      return;
    }

    const response = await handleTelegramPreferenceCommand({
      config,
      command,
      text: `/${command} set ${value} tournament:${tournament.tournamentId}`,
      user,
      memory,
      selectedTournamentId: tournament.tournamentId,
    });
    if (/^Command denied\.|^Missing value|^No tournament profile/.test(response)) {
      await sendTelegramMessage(config, chat.id, response);
      return;
    }
    const updatedPreference = resolveTelegramPreferenceForDefaults(config, callback.from, tournament);
    await sendTelegramMessage(
      config,
      chat.id,
      renderPreferenceDefaultsUpdatedText(tournament, updatedPreference, command),
      renderPreferenceDefaultsKeyboard(command),
    );
    return;
  }

  if (data.startsWith('sp:operator_policy:')) {
    const mode = data.slice('sp:operator_policy:'.length);
    const response = await handleTelegramOperatorCommand({
      command: 'operator_policy',
      text: `/operator_policy mode:${mode}`,
      user,
      config,
    });
    await sendTelegramMessage(config, chat.id, response.text, renderPolicyKeyboard());
    return;
  }

  if (data === 'sp:operator_policy') {
    const response = await handleTelegramOperatorCommand({
      command: 'operator_policy',
      text: '/operator_policy',
      user,
      config,
    });
    await sendTelegramMessage(config, chat.id, response.text, renderPolicyKeyboard());
    return;
  }

  if (data === 'sp:personal:next_open') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    const picker = await safeBuildEligibleMatchPicker(config, tournament, 1, chat.id, true);
    const match = picker?.matches[0];
    if (!match) {
      await sendTelegramMessage(
        config,
        chat.id,
        [
          `No eligible next open match found for ${tournament.name}.`,
          'The bot excludes already predicted, cancelled, finalized, result-proposed, settled, and cutoff-buffered matches.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return;
    }
    await sendTelegramMessage(
      config,
      chat.id,
      [
        `Resolved next open match for ${tournament.name}:`,
        renderEligibleMatchLine(match),
        '',
        'Choose the funding source for this saved decision preview.',
        adminSafetyLine(),
      ].join('\n'),
      renderPredictionFundingKeyboard(match.matchId, config),
    );
    return;
  }

  if (data === 'sp:personal:bundle') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await runPersonalBundle(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:personal:podium') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await runPersonalPodiumStrategy(config, chat.id, callback.from, tournament);
    return;
  }

  if (data.startsWith('sp:podium_approve:')) {
    await approvePodiumPickFromCallback(config, chat.id, callback.from, data.slice('sp:podium_approve:'.length));
    return;
  }

  if (data.startsWith('sp:podium_choose:')) {
    const [, draftId, position] = data.match(/^sp:podium_choose:([^:]+):([^:]+)$/) ?? [];
    await choosePodiumTeamFromCallback(config, chat.id, callback.from, draftId, position, 0);
    return;
  }

  if (data.startsWith('sp:podium_page:')) {
    const [, draftId, position, page] = data.match(/^sp:podium_page:([^:]+):([^:]+):(\d+)$/) ?? [];
    await choosePodiumTeamFromCallback(config, chat.id, callback.from, draftId, position, Number(page));
    return;
  }

  if (data.startsWith('sp:podium_set:')) {
    const [, draftId, position, teamIndex] = data.match(/^sp:podium_set:([^:]+):([^:]+):(\d+)$/) ?? [];
    await setPodiumTeamFromCallback(config, chat.id, callback.from, draftId, position, Number(teamIndex));
    return;
  }

  if (data.startsWith('sp:podium_back:')) {
    await showPodiumDraftFromCallback(config, chat.id, callback.from, data.slice('sp:podium_back:'.length));
    return;
  }

  if (data.startsWith('sp:podium_reset:')) {
    await resetPodiumDraftFromCallback(config, chat.id, callback.from, data.slice('sp:podium_reset:'.length));
    return;
  }

  if (data.startsWith('sp:podium_cancel:')) {
    await cancelPodiumDraftFromCallback(config, chat.id, callback.from, data.slice('sp:podium_cancel:'.length));
    return;
  }

  if (data === 'sp:personal:advisory') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await runPersonalTournamentAdvisory(config, chat.id, callback.from, tournament);
    return;
  }

  if (data.startsWith('sp:personal_export:')) {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    const format = data.slice('sp:personal_export:'.length);
    if (!isPersonalReportExportFormat(format)) {
      await sendTelegramMessage(config, chat.id, 'Export format not recognized. Use /menu and try again.');
      return;
    }
    await sendPersonalReportExport(config, chat.id, callback.from, tournament, format);
    return;
  }

  if (data === 'sp:export_report') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendTelegramMessage(
      config,
      chat.id,
      [renderFriendlyExportPrompt(tournament), adminSafetyLine()].join('\n'),
      renderExportReportKeyboard(),
    );
    return;
  }

  if (data === 'sp:personal_reports:list') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPersonalSavedReportLookup(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:personal_reports:discard_finished') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await discardFinishedPersonalReports(config, chat.id, callback.from, tournament);
    return;
  }

  if (data.startsWith('sp:report_discard:')) {
    await confirmPersonalSavedReportDiscard(
      config,
      chat.id,
      callback.from,
      data.slice('sp:report_discard:'.length),
    );
    return;
  }

  if (data.startsWith('sp:report_delete:')) {
    await discardPersonalSavedReport(
      config,
      chat.id,
      callback.from,
      data.slice('sp:report_delete:'.length),
    );
    return;
  }

  if (data.startsWith('sp:personal_report:')) {
    await sendPersonalSavedReportDetail(config, chat.id, callback.from, data.slice('sp:personal_report:'.length));
    return;
  }

  if (data === 'sp:prediction_history') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPredictionHistoryReport(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:prediction_history_sync') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await syncChainPredictionsAndShowHistory(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:calibration') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPostMatchCalibrationReport(config, chat.id, callback.from, tournament);
    return;
  }

  if (data === 'sp:personal:pick_match' || data === 'sp:personal:leaderboard') {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    await sendPersonalEligibleMatchPicker(
      config,
      chat.id,
      tournament,
      data === 'sp:personal:leaderboard' ? 'simulation' : 'decision',
    );
    return;
  }

  if (
    data.startsWith('sp:personal_decide:') ||
    data.startsWith('sp:personal_sim:') ||
    data.startsWith('sp:personal_timing:') ||
    data.startsWith('sp:personal_position:') ||
    data.startsWith('sp:personal_alternatives:')
  ) {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    const parsedAction = parsePersonalMatchActionCallback(data);
    if (!parsedAction) {
      await sendTelegramMessage(config, chat.id, 'Personal match action not recognized. Use /menu to start again.');
      return;
    }
    if (parsedAction.action === 'decision' || parsedAction.action === 'simulation') {
      if (parsedAction.action === 'decision') {
        await sendPredictionFundingChoice(config, chat.id, tournament, parsedAction.matchId);
        return;
      }
      await runPersonalOperatorDecision(
        config,
        chat.id,
        callback.from,
        tournament,
        parsedAction.matchId,
        parsedAction.action === 'simulation' ? 'operator_simulate' : 'operator_decide',
      );
      return;
    }
    await runPersonalStrategyAnalysis(config, chat.id, callback.from, tournament, parsedAction.matchId, parsedAction.action);
    return;
  }

  if (data.startsWith('sp:personal_funding:')) {
    const tournament = await resolveCallbackTournament(config, chat.id, callback.from);
    if (!tournament) {
      await sendTelegramMessage(config, chat.id, 'Choose a tournament first. Use /menu to start again.');
      return;
    }
    const parsedFunding = parsePersonalFundingCallback(data);
    if (!parsedFunding) {
      await sendTelegramMessage(config, chat.id, 'Prediction funding choice not recognized. Use /menu to start again.');
      return;
    }
    await runPersonalOperatorDecision(
      config,
      chat.id,
      callback.from,
      tournament,
      parsedFunding.matchId,
      'operator_decide',
      parsedFunding.fundingSource,
    );
    return;
  }

  if (data.startsWith('sp:operator_approve:')) {
    const decisionId = data.slice('sp:operator_approve:'.length);
    if (!savedDecisionExists(decisionId)) {
      await sendTelegramMessage(
        config,
        chat.id,
        [
          'Operator approval rejected.',
          `Decision not found in local memory: ${decisionId}`,
          '',
          'The approval button can execute only an existing saved DecisionReport.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return;
    }

    const response = await handleTelegramOperatorCommand({
      command: 'operator_approve',
      text: `/operator_approve decision:${decisionId}`,
      user,
      config,
    });
    await sendTelegramLongMessage(config, chat.id, response.text);
    return;
  }

  if (data.startsWith('sp:approval_value:')) {
    await startApprovalValueTextFlowFromCallback(
      config,
      chat.id,
      callback.from,
      data.slice('sp:approval_value:'.length),
    );
    return;
  }

  if (data.startsWith('sp:approval_value_approve:')) {
    await approveApprovalValueDraftFromCallback(
      config,
      chat.id,
      callback.from,
      data.slice('sp:approval_value_approve:'.length),
    );
    return;
  }

  if (data.startsWith('sp:match_pick_choose:')) {
    await startMatchPickScoreTextFlowFromCallback(config, chat.id, callback.from, data.slice('sp:match_pick_choose:'.length));
    return;
  }

  if (data.startsWith('sp:match_pick_page:')) {
    const [, draftId, page] = data.match(/^sp:match_pick_page:([^:]+):(\d+)$/) ?? [];
    await showMatchPickScoreChooserFromCallback(config, chat.id, callback.from, draftId, Number(page));
    return;
  }

  if (data.startsWith('sp:match_pick_score:')) {
    const [, draftId, home, away] = data.match(/^sp:match_pick_score:([^:]+):(\d+):(\d+)$/) ?? [];
    await setMatchPickScoreFromCallback(config, chat.id, callback.from, draftId, Number(home), Number(away));
    return;
  }

  if (data.startsWith('sp:match_pick_penalty:')) {
    const [, draftId, penalty] = data.match(/^sp:match_pick_penalty:([^:]+):(home|away)$/) ?? [];
    await setMatchPickPenaltyFromCallback(config, chat.id, callback.from, draftId, penalty);
    return;
  }

  if (data.startsWith('sp:match_pick_back:')) {
    await showMatchPickDraftFromCallback(config, chat.id, callback.from, data.slice('sp:match_pick_back:'.length));
    return;
  }

  if (data.startsWith('sp:match_pick_reset:')) {
    await resetMatchPickDraftFromCallback(config, chat.id, callback.from, data.slice('sp:match_pick_reset:'.length));
    return;
  }

  if (data.startsWith('sp:match_pick_approve:')) {
    await approveMatchPickDraftFromCallback(config, chat.id, callback.from, data.slice('sp:match_pick_approve:'.length));
    return;
  }

  if (data === 'sp:freebet') {
    wizardSessions.set(key, { step: 'awaiting_freebet_wallet' });
    await sendTelegramMessage(config, chat.id, 'Send the public 0x wallet address to check freebet status.');
    return;
  }

  if (data === 'sp:freebet_status') {
    const report = await buildFreebetStatusReport(config, { wallet: config.wallet.hexAddress });
    await sendTelegramMessage(config, chat.id, [renderFriendlyFreebetStatus(report), personalSafetyLine()].join('\n\n'));
    return;
  }

  if (data === 'sp:refund_status') {
    const report = await buildRefundStatusReport(config, { wallet: config.wallet.hexAddress });
    await sendTelegramMessage(
      config,
      chat.id,
      [renderFriendlyRefundStatus(report), personalSafetyLine()].join('\n\n'),
      renderClaimStatusKeyboard(),
    );
    return;
  }

  if (data === 'sp:claim_pending') {
    await sendClaimPendingPlan(config, chat.id, user);
    return;
  }

  if (data.startsWith('sp:claim_approve:')) {
    await approveClaimPlanFromCallback(config, chat.id, user, data.slice('sp:claim_approve:'.length));
    return;
  }

  if (data === 'sp:exposure_limits') {
    await sendTelegramMessage(config, chat.id, renderExposureStakeLimits(config));
    return;
  }

  if (data === 'sp:cancel') {
    const session = wizardSessions.get(key);
    if (session?.matchPickDraftId) matchPickDrafts.delete(session.matchPickDraftId);
    deletePodiumDraftsForChatUser(chat.id, callback.from);
    deleteApprovalValueDraftsForChatUser(chat.id, callback.from);
    wizardSessions.delete(key);
    await sendTelegramMessage(config, chat.id, ['Cancelled. Use /menu to start again.', personalSafetyLine()].join('\n'));
    return;
  }

  await sendTelegramMessage(config, chat.id, 'Unknown menu action. Use /menu to start again.');
}

async function handleWizardText(config: AgentConfig, message: TelegramMessage, text: string): Promise<void> {
  if (message.chat.type && message.chat.type !== 'private') return;
  const user = telegramUserContext(message.from);
  const key = wizardKey(message.chat.id, message.from);
  const session = wizardSessions.get(key);
  if (!session) return;

  if (session.step === 'awaiting_freebet_wallet') {
    wizardSessions.delete(key);
    const wallet = normalizePublicWalletAddress(text);
    if (!wallet) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        'Please send only a public 0x wallet address. Never send a mnemonic, seed phrase, private key, or wallet JSON.',
      );
      return;
    }
    const report = await buildFreebetStatusReport(config, { wallet });
    await sendTelegramMessage(
      config,
      message.chat.id,
      [renderFriendlyFreebetStatus(report), personalSafetyLine()].join('\n\n'),
    );
    return;
  }

  if (session.step === 'awaiting_approval_stake_usd') {
    const decisionId = session.approvalDecisionId;
    const decision = decisionId ? new MemoryStore().getDecision(decisionId) : null;
    if (!decision) {
      wizardSessions.delete(key);
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'Prediction value change cancelled.',
          'The saved DecisionReport is missing or stale.',
          '',
          'Next action',
          'Generate a fresh prediction preview, then use Change Stake / Value from the new approval buttons.',
          adminSafetyLine(),
        ].join('\n'),
      );
      return;
    }

    const stakeUsd = parseStakeUsdAmount(text);
    if (!stakeUsd) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          `Please send the new stake value in USD for ${decision.match.home} vs ${decision.match.away}.`,
          'Examples: 3 or 4.50',
          '',
          'This only updates the approval value. It does not submit a prediction.',
        ].join('\n'),
      );
      return;
    }

    try {
      const conversion = await usdToPlanck(config, stakeUsd);
      const draft = buildApprovalValueDraft({
        chatId: message.chat.id,
        from: message.from,
        decisionId: decision.id,
        valuePlanck: conversion.planck,
        valueLabel: `USD ${stakeUsd} converted to ${formatFriendlyPlanckAmount(conversion.planck, conversion.price)}`,
        stakeUsd,
      });
      approvalValueDrafts.set(draft.id, draft);
      wizardSessions.delete(key);
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'Prediction value refreshed',
          `Match #${decision.matchId}: ${decision.match.home} vs ${decision.match.away}`,
          '',
          `New value to attach: ${draft.valueLabel}.`,
          '',
          'Nothing has been submitted yet.',
          'Tap the approval button below to run the guarded executor with this refreshed value.',
          adminSafetyLine(),
        ].join('\n'),
        renderApprovalValueDraftKeyboard(draft, decision),
      );
    } catch (error) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'Could not refresh the prediction value.',
          'The live VARA/USD conversion was not available cleanly.',
          '',
          'Next action',
          'Try again in a few minutes, or generate a fresh prediction preview after the price feed recovers.',
          error instanceof Error ? `Read note: ${error.message}` : null,
          adminSafetyLine(),
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n'),
      );
    }
    return;
  }

  if (session.step === 'awaiting_match_pick_home_score') {
    const draft = await resolveMatchPickDraftForTextSession(config, message, session);
    if (!draft) return;
    const homeScore = parseManualScoreNumber(text);
    if (homeScore === null) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          `Please send only the number of goals for ${draft.decision.match.home}.`,
          'Example: 2',
        ].join('\n'),
      );
      return;
    }
    draft.selectedScore = { ...draft.selectedScore, home: homeScore };
    draft.selectedPenaltyWinner = null;
    session.step = 'awaiting_match_pick_away_score';
    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        `Got it: ${draft.decision.match.home} ${homeScore}.`,
        '',
        `Now send the number of goals for ${draft.decision.match.away}.`,
        'Example: 1',
      ].join('\n'),
    );
    return;
  }

  if (session.step === 'awaiting_match_pick_away_score') {
    const draft = await resolveMatchPickDraftForTextSession(config, message, session);
    if (!draft) return;
    const awayScore = parseManualScoreNumber(text);
    if (awayScore === null) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          `Please send only the number of goals for ${draft.decision.match.away}.`,
          'Example: 1',
        ].join('\n'),
      );
      return;
    }
    draft.selectedScore = { ...draft.selectedScore, away: awayScore };
    draft.selectedPenaltyWinner = null;
    if (matchPickNeedsPenaltyWinner(draft)) {
      session.step = 'awaiting_match_pick_penalty_winner';
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          `Selected score: ${draft.decision.match.home} ${draft.selectedScore.home}-${draft.selectedScore.away} ${draft.decision.match.away}.`,
          '',
          'This is a knockout draw, so the prediction also needs who advances on penalties.',
          `Choose ${draft.decision.match.home} or ${draft.decision.match.away}.`,
        ].join('\n'),
        renderMatchPickPenaltyKeyboard(draft),
      );
      return;
    }
    wizardSessions.delete(key);
    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        'Manual score selected.',
        '',
        renderMatchPickSelectedSlate(draft),
        '',
        'Review it, then approve only if this is the score you want to submit.',
      ].join('\n'),
      renderMatchPickDraftKeyboard(draft),
    );
    return;
  }

  if (session.step === 'awaiting_match_pick_penalty_winner') {
    const draft = await resolveMatchPickDraftForTextSession(config, message, session);
    if (!draft) return;
    const penaltyWinner = parseManualPenaltyWinner(text, draft);
    if (!penaltyWinner) {
      await sendTelegramMessage(
        config,
        message.chat.id,
        [
          'Penalty winner was not recognized.',
          `Please send ${draft.decision.match.home}, ${draft.decision.match.away}, 1, or 2.`,
        ].join('\n'),
        renderMatchPickPenaltyKeyboard(draft),
      );
      return;
    }
    draft.selectedPenaltyWinner = penaltyWinner;
    wizardSessions.delete(key);
    await sendTelegramMessage(
      config,
      message.chat.id,
      [
        'Manual score and penalty winner selected.',
        '',
        renderMatchPickSelectedSlate(draft),
        '',
        'Review it, then approve only if this is the pick you want to submit.',
      ].join('\n'),
      renderMatchPickDraftKeyboard(draft),
    );
    return;
  }
}

function renderStart(config: AgentConfig): string {
  return [
    `${config.telegram.publicBotName}`,
    'Personal SmartCup League prediction agent for your connected wallet.',
    '',
    'Start with /menu for guided personal predictions, strategy, reports, wallet checks, and settings.',
    personalSafetyLine(),
  ].join('\n');
}

function renderHelp(): string {
  return [
    'Personal commands:',
    '/menu',
    '/agent_status',
    '/freebet wallet:<0x_wallet>',
    '/claim_status wallet:<0x_wallet>',
    '/risk show | /risk set contrarian',
    '/objective show | /objective set catch_up',
    '/strategy show | /strategy set protect_lead',
    '',
    'Operator/admin commands are restricted by TELEGRAM_ADMIN_IDS.',
    '/operator_decide match:<id> risk:balanced',
    '/operator_simulate match:<id> objective:balanced',
    '/operator_approve decision:<decision_id>',
    '/operator_policy mode:approval_required',
    personalSafetyLine(),
  ].join('\n');
}

type ClaimPlanCliResult = {
  checkedAt: string;
  wallet: string;
  plans: StoredTransactionPlan[];
  skipped: Array<{
    kind: TransactionKind;
    matchId?: string;
    reason: string;
  }>;
  warnings: string[];
};

function renderClaimStatusKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [[{ text: 'Claim Pending', callback_data: 'sp:claim_pending' }]],
  };
}

async function sendClaimPendingPlan(
  config: AgentConfig,
  chatId: number | string,
  user: TelegramUserContext,
): Promise<void> {
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Claim automation is operator-only.',
        `Reason: ${permission.reason}`,
        '',
        'You can still use Claim Status as a read-only check.',
        personalSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  try {
    const output = await npmRunCli(['claim', '--', 'pending', '--format', 'json']);
    const result = extractJsonPayload<ClaimPlanCliResult>(output);
    if (!result) {
      await sendTelegramMessage(
        config,
        chatId,
        renderFriendlySourceFallback({
          title: 'Claim planning could not be summarized',
          rawMessages: [output],
          impact: 'The agent ran the claim planner, but could not parse the audit payload.',
          fallbackAction: 'Run Claim Status again before retrying. Do not manually repeat a claim unless the status still shows it as pending.',
        }),
      );
      return;
    }

    await sendTelegramMessage(config, chatId, renderClaimPendingPlan(result), renderClaimPlanKeyboard(result));
  } catch (error) {
    await sendTelegramMessage(
      config,
      chatId,
      renderFriendlySourceFallback({
        title: 'Claim planning could not run',
        rawMessages: [error instanceof Error ? error.message : String(error)],
        impact: 'The agent could not prove which rewards are claimable right now.',
        fallbackAction: 'Retry after a short pause, then check Claim Status again.',
      }),
    );
  }
}

async function approveClaimPlanFromCallback(
  config: AgentConfig,
  chatId: number | string,
  user: TelegramUserContext,
  shortPlanId: string,
): Promise<void> {
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Claim approval denied.\nReason: ${permission.reason}`);
    return;
  }

  const plan = resolveStoredClaimPlanByShortId(shortPlanId);
  if (!plan) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Claim approval rejected.',
        'The stored claim plan could not be found.',
        '',
        'Next action',
        'Run Claim Status, then Claim Pending again to generate a fresh plan.',
        personalSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  try {
    const output = await npmRunCli([
      'submit',
      '--',
      '--plan',
      plan.id,
      '--execute',
      'true',
      '--confirm-execute',
      'true',
    ]);
    const parsed = extractJsonPayload<FriendlyLiveExecutionPayload>(output);
    await sendTelegramLongMessage(
      config,
      chatId,
      [
        parsed
          ? renderFriendlyLiveExecutionResult(parsed, { decisionId: plan.decisionId ?? plan.id })
          : renderFriendlySourceFallback({
              title: 'Claim approval result could not be summarized',
              rawMessages: [output],
              impact: 'The claim approval command completed, but the bot could not parse the transaction audit payload.',
              fallbackAction: 'Check Claim Status before retrying. Do not approve the same claim twice unless readback still shows it pending.',
            }),
        personalSafetyLine(),
      ].join('\n\n'),
    );
  } catch (error) {
    await sendTelegramLongMessage(
      config,
      chatId,
      renderFriendlySourceFallback({
        title: 'Claim approval could not continue',
        rawMessages: [error instanceof Error ? error.message : String(error)],
        impact: 'The claim was not confirmed through the guarded executor.',
        fallbackAction: 'Run Claim Status again. If the claim is still pending, generate a fresh Claim Pending plan.',
      }),
    );
  }
}

function renderClaimPendingPlan(result: ClaimPlanCliResult): string {
  const executablePlans = result.plans.filter((plan) => plan.status !== 'blocked');
  const lines = [
    'Claim pending rewards',
    'The agent checked the connected wallet and prepared only the claims it can prove are currently eligible.',
    '',
    `Wallet: ${shortAddress(result.wallet)}`,
    `Ready to approve: ${executablePlans.length}`,
  ];

  if (executablePlans.length > 0) {
    lines.push('', 'Claims ready:');
    for (const plan of executablePlans) {
      lines.push(`- ${friendlyClaimKind(plan)}.`);
    }
  } else {
    lines.push('', 'No claimable rewards are ready right now.');
  }

  if (result.skipped.length > 0) {
    lines.push('', 'Not claimable now:');
    for (const skipped of result.skipped.slice(0, 6)) {
      const match = skipped.matchId ? ` match ${skipped.matchId}` : '';
      lines.push(`- ${friendlyClaimKindName(skipped.kind)}${match}: ${skipped.reason}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('', 'Source quality:', 'Some reads were degraded, so the agent prepared only claims it could still verify.');
  }

  lines.push('', 'Next action');
  lines.push(
    executablePlans.length > 0
      ? 'Tap one Approve Claim button to sign that specific claim after the final guard re-check.'
      : 'Check again after matches finalize or final prize settlement is complete.',
  );
  return lines.join('\n');
}

function renderClaimPlanKeyboard(result: ClaimPlanCliResult): TelegramInlineKeyboard | undefined {
  const rows = result.plans
    .filter((plan) => plan.status !== 'blocked')
    .slice(0, 8)
    .map((plan) => [
      {
        text: `Approve ${friendlyClaimKind(plan)}`,
        callback_data: `sp:claim_approve:${shortPlanHash(plan.id)}`,
      },
    ]);
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

function resolveStoredClaimPlanByShortId(shortPlanId: string): StoredTransactionPlan | null {
  return (
    new MemoryStore()
      .listTransactionPlans()
      .filter((plan) => isClaimKind(plan.kind))
      .find((plan) => shortPlanHash(plan.id) === shortPlanId) ?? null
  );
}

function shortPlanHash(planId: string): string {
  return createHash('sha256').update(planId).digest('hex').slice(0, 14);
}

function isClaimKind(kind: TransactionKind): boolean {
  return kind === 'ClaimMatchReward' || kind === 'ClaimFinalPrize' || kind === 'ClaimRefund';
}

function friendlyClaimKind(plan: StoredTransactionPlan): string {
  if (plan.kind === 'ClaimMatchReward') return `match reward${claimMatchSuffix(plan)}`;
  if (plan.kind === 'ClaimFinalPrize') return 'final prize';
  return 'refund recovery';
}

function friendlyClaimKindName(kind: TransactionKind): string {
  if (kind === 'ClaimMatchReward') return 'Match reward';
  if (kind === 'ClaimFinalPrize') return 'Final prize';
  if (kind === 'ClaimRefund') return 'Refund recovery';
  return kind;
}

function claimMatchSuffix(plan: StoredTransactionPlan): string {
  return plan.kind === 'ClaimMatchReward' ? ` for match ${String(plan.args[0] ?? 'unknown')}` : '';
}

function isClaimExecutionRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\bclaim\b/.test(normalized) &&
    /\b(pending|available|ready|reward|rewards|prize|prizes|what is pending|what's pending|everything|all)\b/.test(normalized)
  );
}

function renderMenuText(config: AgentConfig): string {
  return [
    'SmartCup agent menu',
    'Choose the tournament first so match IDs and reports stay in the right SmartCup context.',
    '',
    `Connected account: ${config.wallet.accountName}`,
    `Wallet: ${shortAddress(config.wallet.hexAddress)}`,
    personalSafetyLine(),
  ].join('\n');
}

async function sendTournamentSelector(
  config: AgentConfig,
  chatId: number | string,
  from?: TelegramFrom,
): Promise<void> {
  const tournaments = await listTournamentProfileOptions(config.artifacts.tournamentProfilePath);
  if (tournaments.length === 0) {
    await sendTelegramMessage(config, chatId, 'No tournament profiles are configured yet.');
    return;
  }

  if (tournaments.length === 1 && from) {
    const tournament = tournaments[0];
    if (tournament) {
      wizardSessions.set(wizardKey(chatId, from), {
        step: 'awaiting_tournament_selection',
        tournamentId: tournament.tournamentId,
        tournamentName: tournament.name,
      });
      await sendTelegramMessage(config, chatId, renderProductMenuText(tournament), renderProductMenuKeyboard());
      return;
    }
  }

  await sendTelegramMessage(config, chatId, renderMenuText(config), renderTournamentKeyboard(tournaments));
}

function renderTournamentKeyboard(tournaments: TournamentProfileOption[]): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      ...tournaments.map((tournament) => [
        {
          text: `${tournament.active ? 'Active: ' : ''}${tournament.name}`,
          callback_data: `sp:tournament:${tournament.tournamentId}`,
        },
      ]),
      [{ text: 'Agent Status', callback_data: 'sp:agent_status' }],
      [{ text: 'Saved Defaults', callback_data: 'sp:strategy_settings' }],
      [{ text: 'Operator Policy', callback_data: 'sp:operator_policy' }],
    ],
  };
}

async function findTournamentOption(
  config: AgentConfig,
  tournamentId: string,
): Promise<TournamentProfileOption | null> {
  const tournaments = await listTournamentProfileOptions(config.artifacts.tournamentProfilePath);
  return tournaments.find((tournament) => tournament.tournamentId === tournamentId) ?? null;
}

async function findActiveTournamentOption(config: AgentConfig): Promise<TournamentProfileOption | null> {
  const tournaments = await listTournamentProfileOptions(config.artifacts.tournamentProfilePath);
  return tournaments.find((tournament) => tournament.active) ?? tournaments[0] ?? null;
}

function renderProductMenuText(tournament: TournamentProfileOption): string {
  return [
    'SmartCup agent menu',
    '',
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    tournament.active
      ? 'This is the active local tournament profile used by operator CLI runs.'
      : 'This tournament is configured but is not the current default operator profile.',
    '',
    'Choose a section:',
    'Predict: personal, no-charge recommendations for the connected agent wallet.',
    'Strategy: read-only analysis tools for timing, position, and alternative picks.',
    'Reports: read-only saved decisions, exports, history, and calibration.',
    'Wallet & Safety: connected-wallet checks, limits, refunds, freebets, and policy.',
    'Settings: tournament context, saved reasoning defaults, and data-provider visibility.',
    '',
    'Legend:',
    'Personal means connected-wallet use only. No external-user service flow is created.',
    'Read-only means no transaction plan, approval, or wallet execution.',
    'Guarded execution can happen only after a saved DecisionReport, explicit Approve Plan, and all policy/safety gates.',
    '',
    'Direct commands still work: /help and /agent_status.',
    personalSafetyLine(),
  ].join('\n');
}

function renderProductMenuKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Predict', callback_data: 'sp:section:predict' },
        { text: 'Strategy', callback_data: 'sp:section:strategy' },
      ],
      [
        { text: 'Reports', callback_data: 'sp:section:reports' },
        { text: 'Wallet & Safety', callback_data: 'sp:section:wallet' },
      ],
      [
        { text: 'Settings', callback_data: 'sp:section:settings' },
      ],
    ],
  };
}

export type MenuSection = 'predict' | 'strategy' | 'reports' | 'wallet' | 'settings';

function normalizeMenuSection(value: string): MenuSection | null {
  if (value === 'predict' || value === 'predictions') return 'predict';
  if (value === 'wallet' || value === 'checks' || value === 'account') return 'wallet';
  if (value === 'strategy' || value === 'reports' || value === 'settings') return value;
  return null;
}

export function renderMenuSectionText(tournament: TournamentProfileOption, section: MenuSection): string {
  const header = [
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    '',
  ];

  if (section === 'predict') {
    return [
      'Predict',
      ...header,
      'Personal prediction tools for the connected SmartPredictor wallet.',
      'These buttons use the connected agent wallet by default, do not collect third-party wallet details, do not create service records, and do not charge anything.',
      'Single Match and Next Open Match can save a DecisionReport. Live submission can only follow the explicit Approve Plan button and policy/safety guards.',
      'Bundle, podium, advisory, and competitor analysis are personal analysis flows for the connected wallet.',
      adminSafetyLine(),
    ].join('\n');
  }

  if (section === 'strategy') {
    return [
      'Strategy',
      ...header,
      'Use this section for read-only strategy analysis before deciding what to preview or approve.',
      'Timing Strategy checks whether to predict now, wait, or stop because the cutoff is too close.',
      'Position Strategy reads your tournament posture: leading, mid-table, catch-up, or final swing.',
      'Alternative Picks compares safest, balanced, contrarian, and leaderboard-upside score choices for one match.',
      'Saved defaults live under Settings. This section helps you think; Settings changes what the bot assumes by default.',
      'These actions are read-only and do not change wallet execution permissions.',
      personalSafetyLine(),
    ].join('\n');
  }

  if (section === 'reports') {
    return [
      'Reports',
      ...header,
      'Review saved personal reports, prediction history, export artifacts, and post-match calibration.',
      'Saved Decisions, Prediction History, Calibration, and Export Report are personal read-only records for the connected agent.',
      'Export Report can send Markdown or JSON documents for saved personal decisions.',
      personalSafetyLine(),
    ].join('\n');
  }

  if (section === 'wallet') {
    return [
      'Wallet & Safety',
      ...header,
      'Check the connected agent wallet, tournament progress, freebet status, claim status, stake limits, exposure limits, and execution safety posture.',
      'These buttons default to the configured SmartPredictor wallet and are read-only unless you explicitly enter an approval flow.',
      'Operator Policy can change whether guarded wallet actions are blocked, approval-required, claim-only, or autopilot-ready.',
      personalSafetyLine(),
    ].join('\n');
  }

  return [
    'Settings',
    ...header,
    'Change tournament context, saved recommendation defaults, and data-source visibility.',
    'Use Change Tournament when more than one SmartCup tournament is active; future buttons and natural-language requests will use the selected tournament context.',
    'Risk Defaults, Objective Defaults, and Strategy Defaults are saved assumptions used when your message does not specify a mode.',
    'Settings are configuration-only: no transaction plan and no wallet execution.',
    'Use the Strategy section for analysis tools. Use Settings when you want to change the bot defaults.',
    'Execution policy and wallet safety live under Wallet & Safety.',
    personalSafetyLine(),
  ].join('\n');
}

export function renderMenuSectionKeyboard(section: MenuSection): TelegramInlineKeyboard {
  if (section === 'predict') {
    return {
      inline_keyboard: [
        [
          { text: 'Single Match', callback_data: 'sp:personal:pick_match' },
          { text: 'Next Open Match', callback_data: 'sp:personal:next_open' },
        ],
        [
          { text: '5-Match Bundle', callback_data: 'sp:personal:bundle' },
          { text: 'Podium Strategy', callback_data: 'sp:personal:podium' },
        ],
        [{ text: 'Tournament Advisory', callback_data: 'sp:personal:advisory' }],
        [{ text: 'Competitor Analysis', callback_data: 'sp:personal:leaderboard' }],
        [{ text: 'Back to Sections', callback_data: 'sp:menu' }],
      ],
    };
  }

  if (section === 'strategy') {
    return {
      inline_keyboard: [
        [
          { text: 'Timing Strategy', callback_data: 'sp:strategy_analysis:timing' },
          { text: 'Position Strategy', callback_data: 'sp:strategy_analysis:position' },
        ],
        [{ text: 'Alternative Picks', callback_data: 'sp:strategy_analysis:alternatives' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    };
  }

  if (section === 'reports') {
    return {
      inline_keyboard: [
        [{ text: 'Saved Decisions', callback_data: 'sp:personal_reports:list' }],
        [{ text: 'Prediction History', callback_data: 'sp:prediction_history' }],
        [{ text: 'Calibration', callback_data: 'sp:calibration' }],
        [{ text: 'Export Report', callback_data: 'sp:export_report' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    };
  }

  if (section === 'wallet') {
    return {
      inline_keyboard: [
        [
          { text: 'Agent Status', callback_data: 'sp:agent_status' },
          { text: 'Freebet Status', callback_data: 'sp:freebet_status' },
        ],
        [{ text: 'Claim Status', callback_data: 'sp:refund_status' }],
        [{ text: 'Exposure / Stake Limits', callback_data: 'sp:exposure_limits' }],
        [{ text: 'Operator Policy', callback_data: 'sp:operator_policy' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [{ text: 'Change Tournament', callback_data: 'sp:settings:tournament' }],
      [{ text: 'Risk Defaults', callback_data: 'sp:settings:defaults:risk' }],
      [{ text: 'Objective Defaults', callback_data: 'sp:settings:defaults:objective' }],
      [{ text: 'Strategy Defaults', callback_data: 'sp:settings:defaults:strategy' }],
      [{ text: 'Data Provider Status', callback_data: 'sp:data_provider_status' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

async function resolveCallbackTournament(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
): Promise<TournamentProfileOption | null> {
  const session = wizardSessions.get(wizardKey(chatId, from));
  if (session?.tournamentId) {
    const selectedTournament = await findTournamentOption(config, session.tournamentId);
    if (selectedTournament) return selectedTournament;
  }
  return findActiveTournamentOption(config);
}

async function sendStrategySettingsMenu(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const memory = new MemoryStore();
  const role: StoredTelegramPreference['role'] =
    new TelegramPermissionModel(config).roleFor(user) === 'admin' ? 'operator' : 'user';
  const preference =
    memory.getTelegramPreference({
      subjectId: telegramPreferenceSubjectId(normalizeTelegramId(user.id)),
      tournamentId: tournament.tournamentId,
      role,
    }) ??
    defaultTelegramPreference({
      telegramUserId: user.id,
      tournamentId: tournament.tournamentId,
      role,
    });

  await sendTelegramMessage(
    config,
    chatId,
    renderStrategySettingsText(tournament, preference),
    renderStrategySettingsKeyboard(),
  );
}

async function sendPreferenceDefaultsMenu(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
  subject: PreferenceDefaultsSubject,
): Promise<void> {
  const preference = resolveTelegramPreferenceForDefaults(config, from, tournament);
  await sendTelegramMessage(
    config,
    chatId,
    renderPreferenceDefaultsText(tournament, preference, subject),
    renderPreferenceDefaultsKeyboard(subject),
  );
}

function resolveTelegramPreferenceForDefaults(
  config: AgentConfig,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
): StoredTelegramPreference {
  const user = telegramUserContext(from);
  const memory = new MemoryStore();
  const role: StoredTelegramPreference['role'] =
    new TelegramPermissionModel(config).roleFor(user) === 'admin' ? 'operator' : 'user';
  return (
    memory.getTelegramPreference({
      subjectId: telegramPreferenceSubjectId(normalizeTelegramId(user.id)),
      tournamentId: tournament.tournamentId,
      role,
    }) ??
    defaultTelegramPreference({
      telegramUserId: user.id,
      tournamentId: tournament.tournamentId,
      role,
    })
  );
}

function renderPreferenceDefaultsText(
  tournament: TournamentProfileOption,
  preference: StoredTelegramPreference,
  subject: PreferenceDefaultsSubject,
): string {
  const title = preferenceDefaultsTitle(subject);
  const current =
    subject === 'risk'
      ? preference.defaultRiskMode
      : subject === 'objective'
        ? preference.simulationObjective
        : preference.strategyPosture;
  const description = preferenceDefaultsDescription(subject);
  const options = preferenceDefaultsOptionDescriptions(subject);
  return [
    title,
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    '',
    `Current ${subject} default: ${current}`,
    `Role: ${preference.role}`,
    `Updated: ${preference.updatedAt}`,
    '',
    'What this setting changes:',
    ...description.map((line) => `- ${line}`),
    '',
    'Options:',
    ...options.map((line) => `- ${line}`),
    '',
    'Tap a button to update this default for the selected tournament.',
    'Explicit values in a message still override this default for that one request.',
    'This changes the bot default only; it does not submit predictions or change wallet execution policy.',
    personalSafetyLine(),
  ].join('\n');
}

function renderPreferenceDefaultsUpdatedText(
  tournament: TournamentProfileOption,
  preference: StoredTelegramPreference,
  subject: PreferenceDefaultsSubject,
): string {
  const current =
    subject === 'risk'
      ? preference.defaultRiskMode
      : subject === 'objective'
        ? preference.simulationObjective
        : preference.strategyPosture;
  return [
    `${preferenceDefaultsTitle(subject)} Updated`,
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    '',
    `New ${subject} default: ${current}`,
    `Role: ${preference.role}`,
    `Updated: ${preference.updatedAt}`,
    '',
    ...preferenceDefaultsUpdateMeaning(subject).map((line) => `- ${line}`),
    '',
    'You can tap another option below to change only this same default.',
    'Use Back to Settings if you want to change Risk, Objective, or Strategy separately.',
    'This changes the bot default only; it does not submit predictions or change wallet execution policy.',
    personalSafetyLine(),
  ].join('\n');
}

function preferenceDefaultsTitle(subject: PreferenceDefaultsSubject): string {
  return subject === 'risk' ? 'Risk Defaults' : subject === 'objective' ? 'Objective Defaults' : 'Strategy Defaults';
}

function preferenceDefaultsUpdateMeaning(subject: PreferenceDefaultsSubject): string[] {
  if (subject === 'risk') {
    return [
      'Risk Default changed the pick style used by normal prediction previews when no risk mode is specified.',
      'Objective Default and Strategy Default were not changed.',
    ];
  }
  if (subject === 'objective') {
    return [
      'Objective Default changed how competitor and leaderboard simulations rank candidate scores.',
      'Risk Default and Strategy Default were not changed.',
    ];
  }
  return [
    'Strategy Default changed the broader tournament posture used by advisory and next-action planning.',
    'Risk Default and Objective Default were not changed.',
  ];
}

function preferenceDefaultsDescription(subject: PreferenceDefaultsSubject): string[] {
  if (subject === 'risk') {
    return [
      'Risk Default controls the pick style used by normal prediction previews when you do not say a risk mode.',
      'It affects which score the agent recommends for a match.',
      'Example: "preview next open match" uses this default unless you say "contrarian" or another mode.',
    ];
  }
  if (subject === 'objective') {
    return [
      'Objective Default controls how competitor and leaderboard simulations rank candidate scores.',
      'It affects read-only simulation priorities, not the raw football probability model.',
      'Example: "analyze competitors" uses this objective unless you specify catch-up, protect-lead, or another objective.',
    ];
  }
  return [
    'Strategy Default controls your broader tournament posture across multiple matches.',
    'It guides advisory-style outputs such as tournament advisory, position strategy, and next-action planning.',
    'Example: protect-lead posture favors avoiding unnecessary variance; final-swing posture looks for late separation.',
  ];
}

function preferenceDefaultsOptionDescriptions(subject: PreferenceDefaultsSubject): string[] {
  const balanced = 'Balanced: default all-around mode; mixes probability, points, payout context, and leaderboard context.';
  const catchUp = 'Catch Up: favors higher-upside choices when you need to close a points/rank gap.';
  const protectLead = 'Protect Lead: favors lower-variance choices when preserving rank matters more than swinging for upside.';
  const finalSwing = 'Final Swing: favors high-leverage separation, mainly late in the tournament or when normal play is not enough.';
  if (subject === 'risk') {
    return [
      'Conservative: safer, higher-confidence match picks.',
      balanced,
      'Contrarian: more differentiated picks when public/crowd choices are likely clustered.',
      catchUp,
      protectLead,
      finalSwing,
    ];
  }
  if (subject === 'objective') {
    return [
      balanced,
      catchUp,
      protectLead,
      finalSwing,
      'Contrarian: simulation gives extra attention to differentiation against likely opponent/crowd behavior.',
      'Conservative: simulation gives extra attention to rank safety and point accumulation.',
    ];
  }
  return [
    balanced,
    'Contrarian: tournament posture looks for spots where differentiation is worth the added variance.',
    catchUp,
    protectLead,
    finalSwing,
    'Conservative: tournament posture emphasizes steady point accumulation and fewer swing attempts.',
  ];
}

function renderPreferenceDefaultsKeyboard(subject: PreferenceDefaultsSubject): TelegramInlineKeyboard {
  const prefix = `sp:pref:${subject}:`;
  if (subject === 'risk') {
    return {
      inline_keyboard: [
        [
          { text: 'Conservative', callback_data: `${prefix}conservative` },
          { text: 'Balanced', callback_data: `${prefix}balanced` },
        ],
        [
          { text: 'Contrarian', callback_data: `${prefix}contrarian` },
          { text: 'Catch Up', callback_data: `${prefix}catch_up` },
        ],
        [
          { text: 'Protect Lead', callback_data: `${prefix}protect_lead` },
          { text: 'Final Swing', callback_data: `${prefix}final_swing` },
        ],
        [{ text: 'Back to Settings', callback_data: 'sp:section:settings' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    };
  }

  if (subject === 'objective') {
    return {
      inline_keyboard: [
        [
          { text: 'Conservative', callback_data: `${prefix}conservative` },
          { text: 'Balanced', callback_data: `${prefix}balanced` },
        ],
        [
          { text: 'Contrarian', callback_data: `${prefix}contrarian` },
          { text: 'Catch Up', callback_data: `${prefix}catch_up` },
        ],
        [
          { text: 'Protect Lead', callback_data: `${prefix}protect_lead` },
          { text: 'Final Swing', callback_data: `${prefix}final_swing` },
        ],
        [{ text: 'Back to Settings', callback_data: 'sp:section:settings' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        { text: 'Conservative', callback_data: `${prefix}conservative` },
        { text: 'Balanced', callback_data: `${prefix}balanced` },
      ],
      [
        { text: 'Contrarian', callback_data: `${prefix}contrarian` },
        { text: 'Catch Up', callback_data: `${prefix}catch_up` },
      ],
      [
        { text: 'Protect Lead', callback_data: `${prefix}protect_lead` },
        { text: 'Final Swing', callback_data: `${prefix}final_swing` },
      ],
      [{ text: 'Back to Settings', callback_data: 'sp:section:settings' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

function renderStrategySettingsText(
  tournament: TournamentProfileOption,
  preference: StoredTelegramPreference,
): string {
  return [
    'Saved Defaults',
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    '',
    renderTelegramPreferenceSummary(preference),
    '',
    'These are the saved defaults the bot uses when your message does not specify a mode.',
    'Risk controls normal match preview style. Objective controls competitor/leaderboard simulation. Strategy controls broader tournament posture.',
    'Explicit values in a message still override these defaults for that one request.',
    'For read-only timing, position, and alternative-pick analysis, open the Strategy section.',
    personalSafetyLine(),
  ].join('\n');
}

function renderStrategySettingsKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Risk: Conservative', callback_data: 'sp:pref:risk:conservative' },
        { text: 'Risk: Balanced', callback_data: 'sp:pref:risk:balanced' },
      ],
      [
        { text: 'Risk: Contrarian', callback_data: 'sp:pref:risk:contrarian' },
        { text: 'Risk: Catch Up', callback_data: 'sp:pref:risk:catch_up' },
      ],
      [
        { text: 'Risk: Protect Lead', callback_data: 'sp:pref:risk:protect_lead' },
        { text: 'Risk: Final Swing', callback_data: 'sp:pref:risk:final_swing' },
      ],
      [
        { text: 'Objective: Balanced', callback_data: 'sp:pref:objective:balanced' },
        { text: 'Objective: Catch Up', callback_data: 'sp:pref:objective:catch_up' },
      ],
      [
        { text: 'Objective: Protect Lead', callback_data: 'sp:pref:objective:protect_lead' },
        { text: 'Objective: Final Swing', callback_data: 'sp:pref:objective:final_swing' },
      ],
      [
        { text: 'Strategy: Balanced', callback_data: 'sp:pref:strategy:balanced' },
        { text: 'Strategy: Contrarian', callback_data: 'sp:pref:strategy:contrarian' },
      ],
      [
        { text: 'Strategy: Protect Lead', callback_data: 'sp:pref:strategy:protect_lead' },
        { text: 'Strategy: Final Swing', callback_data: 'sp:pref:strategy:final_swing' },
      ],
      [
        { text: 'Back to Menu', callback_data: 'sp:menu' },
        { text: 'Cancel', callback_data: 'sp:cancel' },
      ],
    ],
  };
}

function isTelegramPreferenceCommand(value: string | undefined): value is TelegramPreferenceCommand {
  return value === 'risk' || value === 'objective' || value === 'strategy';
}

async function sendPersonalEligibleMatchPicker(
  config: AgentConfig,
  chatId: number | string,
  tournament: TournamentProfileOption,
  action: PersonalMatchAction,
): Promise<void> {
  const picker = await safeBuildEligibleMatchPicker(config, tournament, 10, chatId, true);
  if (!picker) return;
  if (picker.matches.length === 0) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        `No eligible open matches found for ${tournament.name}.`,
        'The bot excludes already predicted, cancelled, finalized, result-proposed, settled, and cutoff-buffered matches.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  await sendTelegramMessage(
    config,
    chatId,
    [
      `Choose a match for ${personalMatchActionLabel(action)} in ${tournament.name}`,
      `Showing ${picker.matches.length} of ${picker.totalEligible} eligible matches.`,
      ...renderPickerWarningLines(picker.warnings),
      '',
      ...picker.matches.map(renderEligibleMatchLine),
      '',
      personalMatchActionDescription(action),
      adminSafetyLine(),
    ].join('\n'),
    renderPersonalEligibleMatchKeyboard(picker.matches, action),
  );
}

function renderPersonalEligibleMatchKeyboard(
  matches: MatchEligibilityView[],
  action: PersonalMatchAction,
): TelegramInlineKeyboard {
  const prefix = personalMatchActionPrefix(action);
  return {
    inline_keyboard: [
      ...matches.map((match) => [
        {
          text: renderEligibleMatchLabel(match),
          callback_data: `${prefix}${match.matchId}`,
        },
      ]),
      [{ text: 'Back to Predict', callback_data: 'sp:section:predict' }],
      [{ text: 'Cancel', callback_data: 'sp:cancel' }],
    ],
  };
}

async function sendPredictionFundingChoice(
  config: AgentConfig,
  chatId: number | string,
  tournament: TournamentProfileOption,
  matchId: string,
): Promise<void> {
  await sendTelegramMessage(
    config,
    chatId,
    [
      `Choose funding for match #${matchId} in ${tournament.name}.`,
      '',
      'This only generates a saved DecisionReport. Submission still requires Approve Plan and all wallet safety guards.',
      adminSafetyLine(),
    ].join('\n'),
    renderPredictionFundingKeyboard(matchId, config),
  );
}

function renderPredictionFundingKeyboard(matchId: string, config: AgentConfig): TelegramInlineKeyboard {
  const rows: TelegramInlineKeyboard['inline_keyboard'] = [
    [{ text: 'Predict with VARA', callback_data: `sp:personal_funding:${matchId}:cash` }],
  ];
  if (config.programs.freebetLedger) {
    rows.push([{ text: 'Predict with Freebet', callback_data: `sp:personal_funding:${matchId}:freebet` }]);
  }
  rows.push([{ text: 'Freebet Status', callback_data: 'sp:freebet_status' }]);
  rows.push([{ text: 'Back to Predict', callback_data: 'sp:section:predict' }]);
  rows.push([{ text: 'Cancel', callback_data: 'sp:cancel' }]);
  return { inline_keyboard: rows };
}

function personalMatchActionPrefix(action: PersonalMatchAction): string {
  if (action === 'simulation') return 'sp:personal_sim:';
  if (action === 'timing') return 'sp:personal_timing:';
  if (action === 'position') return 'sp:personal_position:';
  if (action === 'alternatives') return 'sp:personal_alternatives:';
  return 'sp:personal_decide:';
}

function personalMatchActionDescription(action: PersonalMatchAction): string {
  if (action === 'simulation') return 'This is read-only and does not save a DecisionReport.';
  if (action === 'timing') return 'This runs read-only timing analysis: predict now versus wait closer to kickoff.';
  if (action === 'position') return 'This runs read-only tournament-position strategy using rank and points context.';
  if (action === 'alternatives') return 'This runs read-only alternative picks: safest, balanced, contrarian, and leaderboard-upside.';
  return 'This saves a DecisionReport only. Submission still requires Approve Plan.';
}

function personalMatchActionLabel(action: PersonalMatchAction): string {
  if (action === 'simulation') return 'competitor analysis';
  if (action === 'timing') return 'timing strategy';
  if (action === 'position') return 'position strategy';
  if (action === 'alternatives') return 'alternative picks';
  return 'a personal single-match preview';
}

function isPersonalStrategyAction(value: string): value is Extract<PersonalMatchAction, 'timing' | 'position' | 'alternatives'> {
  return value === 'timing' || value === 'position' || value === 'alternatives';
}

function parsePersonalMatchActionCallback(data: string): { action: PersonalMatchAction; matchId: string } | null {
  const mappings: Array<{ prefix: string; action: PersonalMatchAction }> = [
    { prefix: 'sp:personal_decide:', action: 'decision' },
    { prefix: 'sp:personal_sim:', action: 'simulation' },
    { prefix: 'sp:personal_timing:', action: 'timing' },
    { prefix: 'sp:personal_position:', action: 'position' },
    { prefix: 'sp:personal_alternatives:', action: 'alternatives' },
  ];
  for (const mapping of mappings) {
    if (data.startsWith(mapping.prefix)) {
      const matchId = data.slice(mapping.prefix.length);
      return matchId ? { action: mapping.action, matchId } : null;
    }
  }
  return null;
}

function parsePersonalFundingCallback(data: string): { matchId: string; fundingSource: FundingSource } | null {
  const [, matchId, fundingSource] = data.match(/^sp:personal_funding:([^:]+):(cash|freebet)$/) ?? [];
  if (!matchId || !isFundingSource(fundingSource)) return null;
  return { matchId, fundingSource };
}

function isFundingSource(value: unknown): value is FundingSource {
  return value === 'cash' || value === 'freebet';
}

async function runPersonalOperatorDecision(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
  matchId: string,
  command: 'operator_decide' | 'operator_simulate',
  fundingSource?: FundingSource,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun(command, user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal prediction action denied.',
        `Reason: ${permission.reason}`,
        '',
        'Personal prediction previews and leaderboard simulations are operator-only.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const commandText = await applyOperatorPreferencesToCommandText({
    config,
    memory,
    user,
    text:
      command === 'operator_simulate'
        ? `/operator_simulate match:${matchId}`
        : `/operator_decide match:${matchId} funding:${fundingSource ?? 'cash'}`,
    command,
    selectedTournamentId: tournament.tournamentId,
  });
  const response = await handleTelegramOperatorCommand({
    command,
    text: commandText,
    user,
    config,
  });

  await sendTelegramLongMessage(
    config,
    chatId,
    response.text,
    command === 'operator_decide' && response.decisionId ? renderOperatorApprovalKeyboard(response.decisionId) : undefined,
  );
}

async function runPersonalStrategyAnalysis(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
  matchId: string,
  action: Extract<PersonalMatchAction, 'timing' | 'position' | 'alternatives'>,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal strategy analysis denied.',
        `Reason: ${permission.reason}`,
        '',
        'Timing, position, and alternative-pick analysis are operator-only because they expose connected wallet strategy context.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const preference = await resolveTelegramPreferenceForUser({
    config,
    memory,
    user,
    role: 'operator',
    text: `/operator_decide match:${matchId} tournament:${tournament.tournamentId}`,
    selectedTournamentId: tournament.tournamentId,
  });
  const risk = preference?.defaultRiskMode ?? 'balanced';

  await sendTelegramMessage(
    config,
    chatId,
    [
      `Running ${personalMatchActionLabel(action)} for ${tournament.name}, match ${matchId}.`,
      `Risk/default mode: ${risk}`,
      'This is read-only and does not submit or approve a wallet transaction.',
      adminSafetyLine(),
    ].join('\n'),
  );

  const decision = await buildDecisionForMatch(config, matchId, {
    riskMode: risk,
    fundingSource: 'cash',
    stakePlanck: '4500000000000000',
    seed: `personal-${action}-${tournament.tournamentId}-${matchId}`,
    opponentLimit: 500,
    profileLimit: 50,
    topScores: 8,
    iterations: 500,
    candidateLimit: 8,
  });
  await sendTelegramLongMessage(
    config,
    chatId,
    [
      action === 'timing'
        ? renderFriendlyTimingStrategy(decision)
        : action === 'position'
          ? renderFriendlyTournamentPositionStrategy(decision)
          : renderFriendlyAlternativePicks(decision),
      adminSafetyLine(),
    ].join('\n'),
  );
}

async function runPersonalPodiumStrategy(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal podium strategy denied.',
        `Reason: ${permission.reason}`,
        '',
        'Personal podium strategy is operator-only because it uses the connected agent strategy context.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const profile = await loadTournamentProfile(tournament.path);
  const report = buildPersonalPodiumStrategyReport(profile, { pillar: 'personal_operator' });
  const value = await resolvePodiumPickValue(config);
  const draft = buildPodiumApprovalDraft({
    chatId,
    from,
    tournamentId: tournament.tournamentId,
    report,
    valuePlanck: value.planck,
    valueLabel: value.label,
  });
  podiumApprovalDrafts.set(draft.id, draft);
  await sendTelegramLongMessage(
    config,
    chatId,
    [
      renderFriendlyPodiumStrategy(report),
      '',
      'Execution preview',
      renderPodiumSelectedSlate(draft),
      `- Planned attached value: ${value.label}.`,
      '- This has not submitted anything.',
      '- You can approve the agent recommendation or choose the teams yourself from canonical buttons.',
      '- Approval will create a guarded SubmitPodiumPick plan and re-check timing, policy, balance, and exposure.',
      adminSafetyLine(),
    ].join('\n'),
    renderPodiumApprovalKeyboard(draft),
  );
}

async function approvePodiumPickFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Podium approval denied.\nReason: ${permission.reason}`);
    return;
  }

  const draft = podiumApprovalDrafts.get(draftId);
  if (!draft || draft.chatId !== String(chatId) || draft.userId !== String(from.id)) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Podium approval rejected.',
        'The saved podium preview is missing or stale.',
        '',
        'Next action',
        'Run Podium Strategy again, review the fresh slate, then approve from the new button.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }
  const draftAgeMs = Date.now() - Date.parse(draft.createdAt);
  if (!Number.isFinite(draftAgeMs) || draftAgeMs > PODIUM_APPROVAL_DRAFT_TTL_MS) {
    podiumApprovalDrafts.delete(draftId);
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Podium approval expired.',
        'This protects against approving an old champion slate after tournament data may have changed.',
        '',
        'Next action',
        'Run Podium Strategy again and approve only from the fresh button.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  try {
    const output = await npmRunCli([
      'submit',
      '--',
      '--kind',
      'SubmitPodiumPick',
      '--champion',
      draft.selection.champion,
      '--runner-up',
      draft.selection.runnerUp,
      '--third-place',
      draft.selection.thirdPlace,
      '--value-planck',
      draft.valuePlanck,
      '--execute',
      'true',
      '--confirm-execute',
      'true',
    ]);
    const parsed = extractJsonPayload<FriendlyLiveExecutionPayload>(output);
    podiumApprovalDrafts.delete(draftId);
    await sendTelegramLongMessage(
      config,
      chatId,
      [
        parsed
          ? renderFriendlyLiveExecutionResult(parsed, { decisionId: draft.report.id })
          : renderFriendlySourceFallback({
              title: 'Podium approval result could not be summarized',
              rawMessages: [output],
              impact: 'The podium approval command completed, but the bot could not parse the transaction audit payload.',
              fallbackAction: 'Check local transaction history and regenerate the podium strategy before retrying.',
            }),
        adminSafetyLine(),
      ].join('\n\n'),
    );
  } catch (error) {
    await sendTelegramLongMessage(
      config,
      chatId,
      renderFriendlySourceFallback({
        title: 'Podium approval could not continue',
        rawMessages: [error instanceof Error ? error.message : String(error)],
        impact: 'The podium pick was not confirmed through the guarded executor.',
        fallbackAction: 'Refresh Podium Strategy, verify policy/stake limits, and approve only from a fresh preview.',
      }),
    );
  }
}

async function choosePodiumTeamFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string | undefined,
  rawPosition: string | undefined,
  page: number,
): Promise<void> {
  const draft = await podiumApprovalDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  const position = parsePodiumPositionKey(rawPosition);
  if (!position) {
    await sendTelegramMessage(config, chatId, 'Podium position not recognized. Run Podium Strategy again and choose a slot.');
    return;
  }
  await sendTelegramMessage(
    config,
    chatId,
    renderPodiumTeamChooserText(draft, position, page),
    renderPodiumTeamChooserKeyboard(draft, position, page),
  );
}

async function setPodiumTeamFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string | undefined,
  rawPosition: string | undefined,
  rawTeamIndex: number,
): Promise<void> {
  const draft = await podiumApprovalDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  const position = parsePodiumPositionKey(rawPosition);
  const team = podiumTeamOptions()[rawTeamIndex]?.team;
  if (!position || !team) {
    await sendTelegramMessage(config, chatId, 'Team selection not recognized. Run Podium Strategy again and choose from the buttons.');
    return;
  }

  const existingPosition = podiumPositionEntries().find(
    ([key]) => key !== position && normalizeTeamName(draft.selection[key]) === normalizeTeamName(team),
  )?.[1];
  if (existingPosition) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        `${team} is already selected as ${existingPosition}.`,
        'Champion, runner-up, and third place must be three different teams.',
        '',
        'Choose a different team, or reset to the agent recommendation.',
      ].join('\n'),
      renderPodiumTeamChooserKeyboard(draft, position, 0),
    );
    return;
  }

  draft.selection[position] = team;
  await sendTelegramMessage(
    config,
    chatId,
    [
      `Updated ${podiumPositionLabel(position)} to ${team}.`,
      '',
      renderPodiumSelectedSlate(draft),
      '',
      'You can keep editing or approve the selected podium pick.',
    ].join('\n'),
    renderPodiumApprovalKeyboard(draft),
  );
}

async function showPodiumDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = await podiumApprovalDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Podium pick draft',
      '',
      renderPodiumSelectedSlate(draft),
      '',
      'Approve only after checking the selected teams and timing window.',
    ].join('\n'),
    renderPodiumApprovalKeyboard(draft),
  );
}

async function resetPodiumDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = await podiumApprovalDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  draft.selection = defaultPodiumSelection(draft.report);
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Reset to the agent recommendation.',
      '',
      renderPodiumSelectedSlate(draft),
      '',
      'You can approve this slate or choose teams manually.',
    ].join('\n'),
    renderPodiumApprovalKeyboard(draft),
  );
}

async function cancelPodiumDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = podiumApprovalDrafts.get(draftId);
  if (draft?.chatId === String(chatId) && draft.userId === String(from.id)) {
    podiumApprovalDrafts.delete(draftId);
  } else {
    deletePodiumDraftsForChatUser(chatId, from);
  }
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Podium strategy cancelled.',
      'No podium pick was submitted and no transaction plan was approved.',
      '',
      'Use /menu to start a fresh podium strategy or another prediction flow.',
      personalSafetyLine(),
    ].join('\n'),
  );
}

async function resolvePodiumPickValue(config: AgentConfig): Promise<{ planck: U128String; label: string }> {
  const stakeUsd = config.policy.minStakeUsd ?? '3';
  try {
    const conversion = await usdToPlanck(config, stakeUsd);
    return {
      planck: conversion.planck,
      label: `USD ${stakeUsd} converted to ${formatFriendlyPlanckAmount(conversion.planck, conversion.price)}`,
    };
  } catch {
    const fallback = '4500000000000000' as U128String;
    return {
      planck: fallback,
      label: `${formatFriendlyPlanckAmount(fallback, null)} fallback because live USD/VARA conversion was unavailable`,
    };
  }
}

function buildPodiumApprovalDraft(input: {
  chatId: number | string;
  from: TelegramFrom;
  tournamentId: string;
  report: PodiumStrategyReport;
  valuePlanck: U128String;
  valueLabel: string;
}): PodiumApprovalDraft {
  const raw = [
    input.report.id,
    input.tournamentId,
    input.report.recommendation.champion.team,
    input.report.recommendation.runnerUp.team,
    input.report.recommendation.thirdPlace.team,
    input.valuePlanck,
    input.chatId,
    input.from.id,
  ].join('|');
  return {
    id: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    createdAt: new Date().toISOString(),
    chatId: String(input.chatId),
    userId: String(input.from.id),
    tournamentId: input.tournamentId,
    report: input.report,
    selection: defaultPodiumSelection(input.report),
    valuePlanck: input.valuePlanck,
    valueLabel: input.valueLabel,
  };
}

function renderPodiumApprovalKeyboard(draft: PodiumApprovalDraft): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Approve Selected Podium Pick', callback_data: `sp:podium_approve:${draft.id}` }],
      [
        { text: 'Change Champion', callback_data: `sp:podium_choose:${draft.id}:champion` },
        { text: 'Change Runner-up', callback_data: `sp:podium_choose:${draft.id}:runnerUp` },
      ],
      [{ text: 'Change Third Place', callback_data: `sp:podium_choose:${draft.id}:thirdPlace` }],
      [{ text: 'Reset to Agent Recommendation', callback_data: `sp:podium_reset:${draft.id}` }],
      [{ text: 'Cancel', callback_data: `sp:podium_cancel:${draft.id}` }],
    ],
  };
}

async function podiumApprovalDraftForCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string | undefined,
): Promise<PodiumApprovalDraft | null> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Podium selection denied.\nReason: ${permission.reason}`);
    return null;
  }
  const draft = draftId ? podiumApprovalDrafts.get(draftId) : null;
  if (!draft || draft.chatId !== String(chatId) || draft.userId !== String(from.id)) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Podium draft not found.',
        'Run Podium Strategy again, then choose teams from the fresh buttons.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return null;
  }
  const draftAgeMs = Date.now() - Date.parse(draft.createdAt);
  if (!Number.isFinite(draftAgeMs) || draftAgeMs > PODIUM_APPROVAL_DRAFT_TTL_MS) {
    podiumApprovalDrafts.delete(draft.id);
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Podium draft expired.',
        'Run Podium Strategy again so the team list and timing checks are fresh.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return null;
  }
  return draft;
}

function renderPodiumTeamChooserText(draft: PodiumApprovalDraft, position: PodiumPositionKey, page: number): string {
  const pages = podiumTeamPageCount();
  return [
    `Choose ${podiumPositionLabel(position)}`,
    '',
    renderPodiumSelectedSlate(draft),
    '',
    `Showing canonical teams ${page + 1}/${pages}.`,
    'Use buttons only; typed team names are not accepted for podium submission.',
  ].join('\n');
}

function renderPodiumTeamChooserKeyboard(
  draft: PodiumApprovalDraft,
  position: PodiumPositionKey,
  rawPage: number,
): TelegramInlineKeyboard {
  const teams = podiumTeamOptions();
  const pageCount = podiumTeamPageCount();
  const page = Math.min(Math.max(rawPage, 0), Math.max(pageCount - 1, 0));
  const start = page * PODIUM_TEAM_PAGE_SIZE;
  const visible = teams.slice(start, start + PODIUM_TEAM_PAGE_SIZE);
  const rows: TelegramInlineKeyboard['inline_keyboard'] = [];
  for (let index = 0; index < visible.length; index += 2) {
    rows.push(
      visible.slice(index, index + 2).map((team) => ({
        text: team.team,
        callback_data: `sp:podium_set:${draft.id}:${position}:${team.index}`,
      })),
    );
  }
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) nav.push({ text: 'Previous', callback_data: `sp:podium_page:${draft.id}:${position}:${page - 1}` });
  if (page < pageCount - 1) nav.push({ text: 'Next', callback_data: `sp:podium_page:${draft.id}:${position}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: 'Back to Podium Draft', callback_data: `sp:podium_back:${draft.id}` }]);
  rows.push([{ text: 'Cancel', callback_data: `sp:podium_cancel:${draft.id}` }]);
  return { inline_keyboard: rows };
}

function deletePodiumDraftsForChatUser(chatId: number | string, from: TelegramFrom): void {
  for (const [draftId, draft] of podiumApprovalDrafts.entries()) {
    if (draft.chatId === String(chatId) && draft.userId === String(from.id)) {
      podiumApprovalDrafts.delete(draftId);
    }
  }
}

function podiumTeamOptions(): Array<{ index: number; team: string; rating: number }> {
  return DEFAULT_TEAM_RATINGS.slice()
    .sort((left, right) => right.rating - left.rating || left.team.localeCompare(right.team))
    .map((rating, index) => ({
      index,
      team: rating.team,
      rating: rating.rating,
    }));
}

function podiumTeamPageCount(): number {
  return Math.max(1, Math.ceil(podiumTeamOptions().length / PODIUM_TEAM_PAGE_SIZE));
}

function defaultPodiumSelection(report: PodiumStrategyReport): PodiumSelection {
  return {
    champion: report.recommendation.champion.team,
    runnerUp: report.recommendation.runnerUp.team,
    thirdPlace: report.recommendation.thirdPlace.team,
  };
}

function renderPodiumSelectedSlate(draft: PodiumApprovalDraft): string {
  return [
    'Selected slate',
    `- Champion: ${draft.selection.champion}`,
    `- Runner-up: ${draft.selection.runnerUp}`,
    `- Third place: ${draft.selection.thirdPlace}`,
  ].join('\n');
}

function parsePodiumPositionKey(value: string | undefined): PodiumPositionKey | null {
  if (value === 'champion' || value === 'runnerUp' || value === 'thirdPlace') return value;
  return null;
}

function podiumPositionLabel(position: PodiumPositionKey): string {
  if (position === 'champion') return 'Champion';
  if (position === 'runnerUp') return 'Runner-up';
  return 'Third place';
}

function podiumPositionEntries(): Array<[PodiumPositionKey, string]> {
  return [
    ['champion', 'Champion'],
    ['runnerUp', 'Runner-up'],
    ['thirdPlace', 'Third place'],
  ];
}

function normalizeTeamName(team: string): string {
  return team.trim().toLowerCase();
}

async function runPersonalTournamentAdvisory(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_simulate', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal tournament advisory denied.',
        `Reason: ${permission.reason}`,
        '',
        'Personal tournament advisory is operator-only because it uses connected wallet strategy context.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  await sendTelegramMessage(
    config,
    chatId,
    [
      `Building personal tournament advisory for ${tournament.name}.`,
      'This is read-only and may take a moment while eligible matches are refreshed.',
      adminSafetyLine(),
    ].join('\n'),
  );

  const memory = new MemoryStore();
  const profile = await loadTournamentProfile(tournament.path);
  const eligibleMatchPlan = await buildEligibleMatchPlanForWallet({
    config,
    tournamentProfilePath: tournament.path,
  });
  const preference = await resolveTelegramPreferenceForUser({
    config,
    memory,
    user,
    role: 'operator',
    text: `/operator_simulate tournament:${tournament.tournamentId}`,
    selectedTournamentId: tournament.tournamentId,
  });
  const report = buildPersonalTournamentAdvisoryReport({
    config,
    profile,
    eligibleMatchPlan,
    predictions: memory.listPredictions(),
    transactionPlans: memory.listTransactionPlans(),
    preference,
    priorityLimit: 5,
  });

  await sendTelegramLongMessage(
    config,
    chatId,
    [
      renderFriendlyTournamentAdvisory(report),
      adminSafetyLine(),
    ].join('\n'),
  );
}

async function sendPersonalReportExport(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
  format: PersonalReportExportFormat,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal report export denied.',
        `Reason: ${permission.reason}`,
        '',
        'Saved personal report exports are operator-only because they expose full recommendation details.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  try {
    const memory = new MemoryStore();
    const decisions = memory.listDecisions();
    const tournamentDecisions = decisions.filter((decision) => decision.tournament.id === tournament.tournamentId);
    if (decisions.length === 0 || tournamentDecisions.length === 0) {
      await sendTelegramMessage(
        config,
        chatId,
        [
          renderFriendlyExportUnavailable({
            tournamentName: tournament.name,
            tournamentId: tournament.tournamentId,
            totalSavedReports: decisions.length,
            tournamentSavedReports: tournamentDecisions.length,
            storage: memory.storageInfo(),
          }),
          adminSafetyLine(),
        ].join('\n\n'),
      );
      return;
    }
    const exported = buildPersonalReportExport({
      decisions,
      format,
      tournamentId: tournament.tournamentId,
      limit: 5,
    });
    const filename = buildTelegramExportFilename({
      tournamentId: tournament.tournamentId,
      format,
      decisionIds: exported.selectedDecisionIds,
    });
    await sendTelegramMessage(
      config,
      chatId,
      [
        renderFriendlyExportCompletion(exported),
        '',
        `Download: ${filename}`,
        'The export is attached as a Telegram document.',
        '',
        adminSafetyLine(),
      ].join('\n'),
    );
    try {
      await sendTelegramDocument(config, chatId, {
        filename,
        content: exported.text,
        mimeType: format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
        caption: `SmartPredictor personal ${format.toUpperCase()} export`,
      });
    } catch (uploadError) {
      await sendTelegramLongMessage(
        config,
        chatId,
        [
          'Telegram file upload failed, so I am sending the export as text instead.',
          uploadError instanceof Error ? `Upload issue: ${uploadError.message}` : null,
          '',
          renderFriendlyExportContentHeader(format),
          exported.text,
          '',
          adminSafetyLine(),
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      );
    }
  } catch (error) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        renderFriendlyExportError(error),
        adminSafetyLine(),
      ].join('\n'),
    );
  }
}

async function sendPersonalSavedReportLookup(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Saved report lookup denied.',
        `Reason: ${permission.reason}`,
        '',
        'Saved personal report lookup is operator-only because it exposes full recommendation ids and selected scores.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const allDecisions = memory.listDecisions();
  const lookup = buildPersonalSavedReportLookup({
    decisions: allDecisions,
    tournamentId: tournament.tournamentId,
    limit: 10,
  });
  const discardableFinishedCount = allDecisions.filter(
    (decision) => decision.tournament.id === tournament.tournamentId && isDiscardableFinishedDecision(decision),
  ).length;

  await sendTelegramLongMessage(
    config,
    chatId,
    [
      renderFriendlySavedReportLookup(lookup),
      discardableFinishedCount > 0
        ? `\nCleanup available: ${discardableFinishedCount} finished or stale report${discardableFinishedCount === 1 ? '' : 's'} can be discarded from Saved Decisions.`
        : null,
      '',
      'Advanced local filters remain documented in docs/operator-cli.md if you need date, risk, or match filters outside Telegram.',
      adminSafetyLine(),
    ]
      .filter((line): line is string => line !== null)
      .join('\n'),
    renderSavedReportListKeyboard(lookup.reports, discardableFinishedCount > 0),
  );
}

async function sendPersonalSavedReportDetail(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  decisionId: string,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Saved report detail denied.',
        `Reason: ${permission.reason}`,
        '',
        'Saved personal reports are operator-only because they expose connected-wallet recommendation details.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const decision = new MemoryStore().getDecision(decisionId);
  if (!decision) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Saved report not found.',
        `Report id: ${decisionId}`,
        '',
        'This bot instance could not find that saved DecisionReport in local memory.',
        'Open Reports -> Saved Decisions again, or generate a fresh personal prediction preview.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  await sendTelegramLongMessage(
    config,
    chatId,
    [
      'Saved report detail',
      'Review this report before choosing any action below.',
      '',
      renderFriendlyPredictionPreview(decision),
      '',
      'Available actions',
      '- Approve Agent Pick: uses the saved score and re-checks all wallet safety gates.',
      '- Change Stake / Value: refreshes the USD-to-VARA value before approval if the VARA price moved.',
      '- Enter Score Yourself: keeps this saved report context but lets you type your own score.',
      '- Discard Report: removes this saved preview from the active Saved Decisions list.',
      '- Back to Reports: returns to the saved report list.',
      adminSafetyLine(),
    ].join('\n'),
    renderSavedReportDetailKeyboard(decision),
  );
}

function renderSavedReportListKeyboard(
  reports: Array<{ id: string; matchId: string; selectedScore: string; riskMode: RiskMode }>,
  hasDiscardableFinishedReports = false,
): TelegramInlineKeyboard | undefined {
  const latest = reports.slice(0, 5);
  if (latest.length === 0 && !hasDiscardableFinishedReports) return undefined;
  return {
    inline_keyboard: [
      ...latest.map((report, index) => [
        {
          text: `${index + 1}. Open #${report.matchId} ${report.selectedScore} ${formatButtonMode(report.riskMode)}`,
          callback_data: `sp:personal_report:${report.id}`,
        },
      ]),
      ...(hasDiscardableFinishedReports
        ? [[{ text: 'Discard Finished Reports', callback_data: 'sp:personal_reports:discard_finished' }]]
        : []),
      [{ text: 'Back to Reports', callback_data: 'sp:section:reports' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

function renderSavedReportDetailKeyboard(decision: DecisionReport): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: `Approve Agent Pick #${decision.matchId}`, callback_data: `sp:operator_approve:${decision.id}` }],
      [{ text: `Change Stake / Value #${decision.matchId}`, callback_data: `sp:approval_value:${decision.id}` }],
      [{ text: `Enter Score Yourself #${decision.matchId}`, callback_data: `sp:match_pick_choose:${decision.id}` }],
      [{ text: `Discard Report #${decision.matchId}`, callback_data: `sp:report_discard:${decision.id}` }],
      [{ text: 'Back to Reports', callback_data: 'sp:personal_reports:list' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

async function confirmPersonalSavedReportDiscard(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  decisionId: string,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Discard denied.\nReason: ${permission.reason}`);
    return;
  }
  const decision = new MemoryStore().getDecision(decisionId);
  if (!decision) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Saved report not found.',
        'It may have already been discarded or this bot instance may not have the same saved-report storage.',
        '',
        'Next action',
        'Open Saved Decisions again to refresh the list.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Discard saved report?',
      `Match #${decision.matchId}: ${decision.match.home} vs ${decision.match.away}`,
      `Pick: ${decision.selected.score.home}-${decision.selected.score.away}`,
      '',
      'This removes the saved preview from Saved Decisions.',
      'It does not cancel or reverse any SmartCup prediction that was already submitted on-chain.',
      '',
      'Use Export Report first if you want to keep a file copy.',
      adminSafetyLine(),
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: 'Yes, Discard Report', callback_data: `sp:report_delete:${decision.id}` }],
        [{ text: `Back to Report #${decision.matchId}`, callback_data: `sp:personal_report:${decision.id}` }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    },
  );
}

async function discardPersonalSavedReport(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  decisionId: string,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Discard denied.\nReason: ${permission.reason}`);
    return;
  }
  const memory = new MemoryStore();
  const decision = memory.getDecision(decisionId);
  const deleted = memory.deleteDecision(decisionId);
  deleteTemporaryDraftsForDecision(decisionId);
  await sendTelegramMessage(
    config,
    chatId,
    [
      deleted ? 'Saved report discarded.' : 'Saved report was not found.',
      decision ? `Match #${decision.matchId}: ${decision.match.home} vs ${decision.match.away}` : `Report id: ${decisionId}`,
      '',
      'No SmartCup transaction was submitted, cancelled, or reversed by this cleanup action.',
      '',
      'Next action',
      'Open Saved Decisions to review the remaining reports, or generate a fresh prediction preview.',
      adminSafetyLine(),
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: 'Back to Saved Decisions', callback_data: 'sp:personal_reports:list' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    },
  );
}

async function discardFinishedPersonalReports(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Finished-report cleanup denied.\nReason: ${permission.reason}`);
    return;
  }
  const memory = new MemoryStore();
  const discardable = memory
    .listDecisions()
    .filter((decision) => decision.tournament.id === tournament.tournamentId && isDiscardableFinishedDecision(decision));
  for (const decision of discardable) {
    memory.deleteDecision(decision.id);
    deleteTemporaryDraftsForDecision(decision.id);
  }
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Finished-report cleanup complete.',
      `Tournament: ${tournament.name}`,
      `Discarded reports: ${discardable.length}`,
      '',
      'What was removed',
      '- Saved previews for matches already finalized, settled, cancelled, or older than the post-match cleanup window.',
      '',
      'What was not changed',
      '- On-chain SmartCup predictions.',
      '- Transaction history and submitted prediction truth.',
      '',
      'Next action',
      'Open Saved Decisions to inspect the remaining actionable reports.',
      adminSafetyLine(),
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: 'Back to Saved Decisions', callback_data: 'sp:personal_reports:list' }],
        [{ text: 'Main Menu', callback_data: 'sp:menu' }],
      ],
    },
  );
}

function formatButtonMode(value: RiskMode): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

async function sendPredictionHistoryReport(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Prediction history denied.',
        `Reason: ${permission.reason}`,
        '',
        'Prediction history is operator-only because it exposes connected-wallet prediction records.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const decisions = memory.listDecisions().filter((decision) => decision.tournament.id === tournament.tournamentId);
  const decisionIds = new Set(decisions.map((decision) => decision.id));
  const evaluations = memory
    .listOutcomeEvaluations()
    .filter((evaluation) => decisionIds.has(evaluation.decisionId));
  const predictions = memory.listPredictions();

  await sendTelegramLongMessage(
    config,
    chatId,
    [
      renderFriendlyPredictionHistory({
        tournament,
        predictions,
        decisions,
        evaluations,
      }),
      adminSafetyLine(),
    ].join('\n'),
    renderPredictionHistoryKeyboard(),
  );
}

async function syncChainPredictionsAndShowHistory(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Prediction sync denied.',
        `Reason: ${permission.reason}`,
        '',
        'Syncing prediction history is operator-only because it imports connected-wallet chain records.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  try {
    const memory = new MemoryStore();
    const report = await reconcileChainPredictions(config, memory);
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Prediction history synced from chain.',
        `Wallet: ${report.wallet}`,
        `Imported or refreshed records: ${report.upsertedPredictions.length}`,
        `Removed stale records: ${report.removedPredictionIds.length}`,
        `Final local prediction count: ${report.finalPredictionCount}`,
        '',
        report.upsertedPredictions.length
          ? 'Latest imported matches:'
          : 'No wallet predictions were returned by live QueryBetsByUser.',
        ...report.upsertedPredictions.slice(0, 6).map(
          (prediction) =>
            `- Match #${prediction.matchId}: ${prediction.score.home}-${prediction.score.away} ${prediction.predictedOutcome}; source ${prediction.source}.`,
        ),
        ...report.notes.map((note) => `Note: ${note}`),
        '',
        'Next action',
        'The refreshed history report follows below.',
        adminSafetyLine(),
      ].join('\n'),
    );
    await sendPredictionHistoryReport(config, chatId, from, tournament);
  } catch (error) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Could not sync prediction history from chain.',
        '',
        'Why this can happen',
        '- BolaoCore QueryBetsByUser was unavailable, timed out, or returned data the local adapter could not parse.',
        '',
        'What stayed safe',
        '- No transaction was submitted.',
        '- Existing saved DecisionReports and local records were not rewritten after the failed read.',
        '',
        'Next action',
        'Try again later from Reports -> Prediction History -> Sync Chain Predictions.',
        error instanceof Error ? `Read note: ${error.message}` : null,
        adminSafetyLine(),
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    );
  }
}

function renderPredictionHistoryKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Sync Chain Predictions', callback_data: 'sp:prediction_history_sync' }],
      [{ text: 'Back to Reports', callback_data: 'sp:section:reports' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

async function sendPostMatchCalibrationReport(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom | undefined,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Calibration report denied.',
        `Reason: ${permission.reason}`,
        '',
        'Post-match calibration exposes full saved prediction details and is operator-only.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const report = new PostMatchCalibrationModel().buildReport({
    decisions: memory.listDecisions(),
    evaluations: memory.listOutcomeEvaluations(),
    tournamentId: tournament.tournamentId,
    matchId: null,
    limit: 20,
  });
  await sendTelegramLongMessage(
    config,
    chatId,
    [
      renderFriendlyPostMatchCalibration(report),
      adminSafetyLine(),
    ].join('\n'),
  );
}

async function runPersonalBundle(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  tournament: TournamentProfileOption,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_decide', user);
  if (!permission.allowed) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Personal bundle action denied.',
        `Reason: ${permission.reason}`,
        '',
        'Personal 5-match bundle generation is operator-only.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const picker = await safeBuildEligibleMatchPicker(config, tournament, ANALYSIS_BUNDLE_TARGET_MATCH_COUNT, chatId, true);
  if (!picker) return;
  if (picker.matches.length < ANALYSIS_BUNDLE_TARGET_MATCH_COUNT) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        `Personal 5-match bundle unavailable for ${tournament.name}.`,
        `Eligible matches found: ${picker.matches.length}/${ANALYSIS_BUNDLE_TARGET_MATCH_COUNT}.`,
        'The bundle requires exactly five eligible open matches for the connected wallet.',
        ...renderPickerWarningLines(picker.warnings),
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const memory = new MemoryStore();
  const preference = await resolveTelegramPreferenceForUser({
    config,
    memory,
    user,
    role: 'operator',
    text: `/operator_decide tournament:${tournament.tournamentId}`,
    selectedTournamentId: tournament.tournamentId,
  });
  const riskMode = preference?.defaultRiskMode ?? 'balanced';
  const selectedMatches = picker.matches.slice(0, ANALYSIS_BUNDLE_TARGET_MATCH_COUNT);

  await sendTelegramMessage(
    config,
    chatId,
    [
      `Generating personal 5-match bundle for ${tournament.name}.`,
      `Risk mode: ${riskMode}`,
      `Matches: ${selectedMatches.map((match) => `#${match.matchId}`).join(', ')}`,
      '',
      'This saves one DecisionReport per match in your personal agent workspace. It does not start any external-service workflow or transaction submission.',
      adminSafetyLine(),
    ].join('\n'),
  );

  const bundle = await buildBundleDecisions(
    config,
    selectedMatches.map((match) => match.matchId),
    {
      riskMode,
      fundingSource: 'cash',
      stakePlanck: '4500000000000000',
      seed: 'personal-bundle',
      seedPrefix: `personal-bundle-${tournament.tournamentId}`,
      opponentLimit: 500,
      profileLimit: 50,
      topScores: 8,
      iterations: 500,
      candidateLimit: 8,
    },
  );
  for (const decision of bundle.decisions) memory.saveDecision(decision);

  const friendlyBundle = renderFriendlyPersonalBundle(bundle.decisions, {
    tournamentName: tournament.name,
    riskMode,
  });

  await sendTelegramLongMessage(
    config,
    chatId,
    [
      friendlyBundle,
      adminSafetyLine(),
    ].join('\n'),
  );
}

function renderPickerWarningLines(warnings: string[]): string[] {
  if (warnings.length === 0) return [];
  const friendlyWarnings = renderFriendlySourceWarningBullets(warnings, 3);
  return [
    '',
    'Read-source note:',
    ...(friendlyWarnings.length ? friendlyWarnings : ['Some supporting reads were degraded.']).map(
      (warning) => `- ${warning}`,
    ),
  ];
}

function renderOperatorApprovalKeyboard(decisionId: string): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Approve Agent Pick', callback_data: `sp:operator_approve:${decisionId}` }],
      [{ text: 'Change Stake / Value', callback_data: `sp:approval_value:${decisionId}` }],
      [{ text: 'Enter Score Yourself', callback_data: `sp:match_pick_choose:${decisionId}` }],
      [{ text: 'Cancel', callback_data: 'sp:cancel' }],
    ],
  };
}

async function startApprovalValueTextFlowFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  decisionId: string | undefined,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Value change denied.\nReason: ${permission.reason}`);
    return;
  }
  if (!decisionId) {
    await sendTelegramMessage(config, chatId, 'Saved report not found. Generate a fresh prediction preview first.');
    return;
  }
  const decision = new MemoryStore().getDecision(decisionId);
  if (!decision) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Prediction value change rejected.',
        `Decision not found in local memory: ${decisionId}`,
        '',
        'Next action',
        'Open Saved Decisions or generate a fresh prediction preview before changing the value.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  wizardSessions.set(wizardKey(chatId, from), {
    step: 'awaiting_approval_stake_usd',
    tournamentId: decision.tournament.id,
    tournamentName: decision.tournament.name,
    approvalDecisionId: decision.id,
  });

  await sendTelegramMessage(
    config,
    chatId,
    [
      'Change prediction value',
      `Match #${decision.matchId}: ${decision.match.home} vs ${decision.match.away}`,
      '',
      `Current saved value: ${formatFriendlyPlanckAmount(decision.economics.stakePlanck, decisionReportVaraUsdPrice(decision))}.`,
      '',
      'Send the new stake amount in USD.',
      'Examples: 3 or 4.50',
      '',
      'The bot will convert it to VARA and then show a final approval button. Typing the amount does not submit anything.',
      adminSafetyLine(),
    ].join('\n'),
  );
}

async function startMatchPickScoreTextFlowFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftOrDecisionId: string | undefined,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftOrDecisionId);
  if (!draft) return;
  wizardSessions.set(wizardKey(chatId, from), {
    step: 'awaiting_match_pick_home_score',
    tournamentId: draft.decision.tournament.id,
    tournamentName: draft.decision.tournament.name,
    matchPickDraftId: draft.id,
  });
  await sendTelegramMessage(
    config,
    chatId,
    [
      `Manual score for match #${draft.decision.matchId}`,
      `${draft.decision.match.home} vs ${draft.decision.match.away}`,
      '',
      `First, send the number of goals for ${draft.decision.match.home}.`,
      'Send only the number, for example: 2',
    ].join('\n'),
  );
}

async function resolveMatchPickDraftForTextSession(
  config: AgentConfig,
  message: TelegramMessage,
  session: WizardSession,
): Promise<MatchPickDraft | null> {
  const from = message.from;
  const draftId = session.matchPickDraftId;
  if (!from || !draftId) {
    wizardSessions.delete(wizardKey(message.chat.id, from));
    await sendTelegramMessage(config, message.chat.id, 'Manual pick draft not found. Generate a fresh match preview first.');
    return null;
  }
  return resolveMatchPickDraftForCallback(config, message.chat.id, from, draftId);
}

function parseManualScoreNumber(text: string): number | null {
  const normalized = text.trim();
  if (!/^\d{1,2}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value >= 0 && value <= 20 ? value : null;
}

function parseManualPenaltyWinner(text: string, draft: MatchPickDraft): PenaltyWinner | null {
  const normalized = normalizeTeamChoiceText(text);
  const home = normalizeTeamChoiceText(draft.decision.match.home);
  const away = normalizeTeamChoiceText(draft.decision.match.away);
  if (normalized === '1' || normalized === 'home' || normalized === home) return 'Home';
  if (normalized === '2' || normalized === 'away' || normalized === away) return 'Away';
  return null;
}

function normalizeTeamChoiceText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function showMatchPickScoreChooserFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftOrDecisionId: string | undefined,
  page: number,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftOrDecisionId);
  if (!draft) return;
  await sendTelegramMessage(
    config,
    chatId,
    renderMatchPickScoreChooserText(draft, page),
    renderMatchPickScoreChooserKeyboard(draft, page),
  );
}

async function setMatchPickScoreFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string | undefined,
  home: number,
  away: number,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away) || home < 0 || away < 0) {
    await sendTelegramMessage(config, chatId, 'Score selection not recognized. Please choose from the score buttons.');
    return;
  }
  draft.selectedScore = { home, away };
  if (!matchPickNeedsPenaltyWinner(draft)) draft.selectedPenaltyWinner = null;
  await sendTelegramMessage(
    config,
    chatId,
    [
      'Updated selected score.',
      '',
      renderMatchPickSelectedSlate(draft),
      '',
      matchPickNeedsPenaltyWinner(draft)
        ? 'This looks like a knockout draw. Choose the penalty winner before approval.'
        : 'You can approve this selected score or keep editing.',
    ].join('\n'),
    renderMatchPickDraftKeyboard(draft),
  );
}

async function setMatchPickPenaltyFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string | undefined,
  rawPenalty: string | undefined,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  if (!matchPickNeedsPenaltyWinner(draft)) {
    draft.selectedPenaltyWinner = null;
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Penalty winner removed.',
        'This score/phase does not need a penalty winner.',
        '',
        renderMatchPickSelectedSlate(draft),
      ].join('\n'),
      renderMatchPickDraftKeyboard(draft),
    );
    return;
  }
  draft.selectedPenaltyWinner = rawPenalty === 'home' ? 'Home' : rawPenalty === 'away' ? 'Away' : null;
  wizardSessions.delete(wizardKey(chatId, from));
  await sendTelegramMessage(
    config,
    chatId,
    ['Penalty winner selected.', '', renderMatchPickSelectedSlate(draft)].join('\n'),
    renderMatchPickDraftKeyboard(draft),
  );
}

async function showMatchPickDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  await sendTelegramMessage(
    config,
    chatId,
    ['Manual match pick draft', '', renderMatchPickSelectedSlate(draft)].join('\n'),
    renderMatchPickDraftKeyboard(draft),
  );
}

async function resetMatchPickDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  draft.selectedScore = draft.decision.selected.score;
  draft.selectedPenaltyWinner = draft.decision.selected.penaltyWinner;
  await sendTelegramMessage(
    config,
    chatId,
    ['Reset to the agent recommendation.', '', renderMatchPickSelectedSlate(draft)].join('\n'),
    renderMatchPickDraftKeyboard(draft),
  );
}

async function approveMatchPickDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const draft = await resolveMatchPickDraftForCallback(config, chatId, from, draftId);
  if (!draft) return;
  if (matchPickNeedsPenaltyWinner(draft) && !draft.selectedPenaltyWinner) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Manual pick approval needs one more choice.',
        'For knockout draws, choose who advances on penalties before approval.',
      ].join('\n'),
      renderMatchPickDraftKeyboard(draft),
    );
    return;
  }

  try {
    const output = await npmRunCli([
      'submit',
      '--',
      '--decision',
      draft.decision.id,
      '--kind',
      'PlaceBet',
      '--score-home',
      String(draft.selectedScore.home),
      '--score-away',
      String(draft.selectedScore.away),
      '--penalty-winner',
      draft.selectedPenaltyWinner ? draft.selectedPenaltyWinner.toLowerCase() : 'none',
      '--execute',
      'true',
      '--confirm-execute',
      'true',
    ]);
    const parsed = extractJsonPayload<FriendlyLiveExecutionPayload>(output);
    matchPickDrafts.delete(draft.id);
    await sendTelegramLongMessage(
      config,
      chatId,
      [
        parsed
          ? renderFriendlyLiveExecutionResult(parsed, { decisionId: draft.decision.id })
          : renderFriendlySourceFallback({
              title: 'Manual pick approval result could not be summarized',
              rawMessages: [output],
              impact: 'The manual pick approval command completed, but the bot could not parse the transaction audit payload.',
              fallbackAction: 'Check local transaction history and regenerate the prediction preview before retrying.',
            }),
        adminSafetyLine(),
      ].join('\n\n'),
    );
  } catch (error) {
    await sendTelegramLongMessage(
      config,
      chatId,
      renderFriendlySourceFallback({
        title: 'Manual pick approval could not continue',
        rawMessages: [error instanceof Error ? error.message : String(error)],
        impact: 'The manual pick was not confirmed through the guarded executor.',
        fallbackAction: 'Refresh the match preview, verify policy/stake limits, and approve only from a fresh button.',
      }),
    );
  }
}

async function approveApprovalValueDraftFromCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftId: string,
): Promise<void> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Approval denied.\nReason: ${permission.reason}`);
    return;
  }

  const draft = approvalValueDrafts.get(draftId);
  if (!draft || draft.chatId !== String(chatId) || draft.userId !== String(from.id)) {
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Refreshed value approval rejected.',
        'The refreshed value draft is missing or belongs to another chat/user.',
        '',
        'Next action',
        'Open the saved report again, choose Change Stake / Value, and approve from the fresh button.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const ageMs = Date.now() - Date.parse(draft.createdAt);
  if (!Number.isFinite(ageMs) || ageMs > APPROVAL_VALUE_DRAFT_TTL_MS) {
    approvalValueDrafts.delete(draft.id);
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Refreshed value approval expired.',
        'This protects against approving an old conversion after the VARA price may have moved again.',
        '',
        'Next action',
        'Choose Change Stake / Value again and approve only from the fresh button.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  if (!savedDecisionExists(draft.decisionId)) {
    approvalValueDrafts.delete(draft.id);
    await sendTelegramMessage(
      config,
      chatId,
      [
        'Refreshed value approval rejected.',
        'The saved DecisionReport is no longer available to this bot instance.',
        '',
        'Next action',
        'Generate a fresh prediction preview before approval.',
        adminSafetyLine(),
      ].join('\n'),
    );
    return;
  }

  const response = await handleTelegramOperatorCommand({
    command: 'operator_approve',
    text: `/operator_approve decision:${draft.decisionId} valuePlanck:${draft.valuePlanck}`,
    user,
    config,
  });
  approvalValueDrafts.delete(draft.id);
  await sendTelegramLongMessage(config, chatId, response.text);
}

async function resolveMatchPickDraftForCallback(
  config: AgentConfig,
  chatId: number | string,
  from: TelegramFrom,
  draftOrDecisionId: string | undefined,
): Promise<MatchPickDraft | null> {
  const user = telegramUserContext(from);
  const permission = new TelegramPermissionModel(config).canRun('operator_approve', user);
  if (!permission.allowed) {
    await sendTelegramMessage(config, chatId, `Manual pick denied.\nReason: ${permission.reason}`);
    return null;
  }
  if (!draftOrDecisionId) {
    await sendTelegramMessage(config, chatId, 'Manual pick draft not found. Generate a fresh match preview first.');
    return null;
  }

  const existing = matchPickDrafts.get(draftOrDecisionId);
  if (existing) {
    if (existing.chatId !== String(chatId) || existing.userId !== String(from.id)) {
      await sendTelegramMessage(config, chatId, 'Manual pick draft belongs to a different chat/user. Generate a fresh preview.');
      return null;
    }
    const ageMs = Date.now() - Date.parse(existing.createdAt);
    if (!Number.isFinite(ageMs) || ageMs > MATCH_PICK_DRAFT_TTL_MS) {
      matchPickDrafts.delete(existing.id);
      await sendTelegramMessage(config, chatId, 'Manual pick draft expired. Generate a fresh match preview before approving.');
      return null;
    }
    return existing;
  }

  const decision = new MemoryStore().getDecision(draftOrDecisionId);
  if (!decision) {
    await sendTelegramMessage(config, chatId, `Decision not found in local memory: ${draftOrDecisionId}`);
    return null;
  }
  const draft = buildMatchPickDraft({ chatId, from, decision });
  matchPickDrafts.set(draft.id, draft);
  return draft;
}

function buildMatchPickDraft(input: {
  chatId: number | string;
  from: TelegramFrom;
  decision: DecisionReport;
}): MatchPickDraft {
  const raw = [input.decision.id, input.chatId, input.from.id].join('|');
  return {
    id: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    createdAt: new Date().toISOString(),
    chatId: String(input.chatId),
    userId: String(input.from.id),
    decision: input.decision,
    selectedScore: input.decision.selected.score,
    selectedPenaltyWinner: input.decision.selected.penaltyWinner,
  };
}

function buildApprovalValueDraft(input: {
  chatId: number | string;
  from: TelegramFrom | undefined;
  decisionId: string;
  valuePlanck: U128String;
  valueLabel: string;
  stakeUsd: string;
}): ApprovalValueDraft {
  const raw = [
    input.decisionId,
    input.valuePlanck,
    input.stakeUsd,
    input.chatId,
    input.from?.id ?? 'unknown',
    Date.now(),
  ].join('|');
  return {
    id: `av-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    chatId: String(input.chatId),
    userId: String(input.from?.id ?? 'unknown'),
    decisionId: input.decisionId,
    valuePlanck: input.valuePlanck,
    valueLabel: input.valueLabel,
    stakeUsd: input.stakeUsd,
  };
}

function renderApprovalValueDraftKeyboard(draft: ApprovalValueDraft, decision: DecisionReport): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: `Approve with USD ${draft.stakeUsd}`, callback_data: `sp:approval_value_approve:${draft.id}` }],
      [{ text: `Back to Report #${decision.matchId}`, callback_data: `sp:personal_report:${decision.id}` }],
      [{ text: 'Cancel', callback_data: 'sp:cancel' }],
    ],
  };
}

function deleteApprovalValueDraftsForChatUser(chatId: number | string, from: TelegramFrom | undefined): void {
  const userId = String(from?.id ?? 'unknown');
  for (const [id, draft] of approvalValueDrafts.entries()) {
    if (draft.chatId === String(chatId) && draft.userId === userId) approvalValueDrafts.delete(id);
  }
}

function deleteTemporaryDraftsForDecision(decisionId: string): void {
  for (const [id, draft] of matchPickDrafts.entries()) {
    if (draft.decision.id === decisionId) matchPickDrafts.delete(id);
  }
  for (const [id, draft] of approvalValueDrafts.entries()) {
    if (draft.decisionId === decisionId) approvalValueDrafts.delete(id);
  }
}

function isDiscardableFinishedDecision(decision: DecisionReport, nowMs = Date.now()): boolean {
  if (decision.match.status !== 'UNRESOLVED') return true;
  const kickoffMs = Number(decision.match.kickOffMs);
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) return false;
  const postMatchCleanupWindowMs = 3 * 60 * 60 * 1000;
  return kickoffMs + postMatchCleanupWindowMs <= nowMs;
}

function parseStakeUsdAmount(value: string): string | null {
  const normalized = value.trim().replace(/^\$/, '').replace(/\s*usd$/i, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 10000) return null;
  return normalized.includes('.') ? normalized.replace(/0+$/, '').replace(/\.$/, '') : normalized;
}

function renderMatchPickScoreChooserText(draft: MatchPickDraft, page: number): string {
  return [
    `Choose score for match #${draft.decision.matchId}`,
    `${draft.decision.match.home} vs ${draft.decision.match.away}`,
    '',
    renderMatchPickSelectedSlate(draft),
    '',
    `Showing score page ${Math.min(Math.max(page, 0), 1) + 1}/2.`,
    'This is the older button selector from a previous message. New manual picks use Enter Score and ask for each team score by text.',
  ].join('\n');
}

function renderMatchPickScoreChooserKeyboard(draft: MatchPickDraft, rawPage: number): TelegramInlineKeyboard {
  const page = Math.min(Math.max(rawPage, 0), 1);
  const homeStart = page === 0 ? 0 : 3;
  const homeEnd = page === 0 ? 2 : MATCH_PICK_MAX_GOALS;
  const rows: TelegramInlineKeyboard['inline_keyboard'] = [];
  for (let home = homeStart; home <= homeEnd; home += 1) {
    const row: Array<{ text: string; callback_data: string }> = [];
    for (let away = 0; away <= MATCH_PICK_MAX_GOALS; away += 1) {
      row.push({ text: `${home}-${away}`, callback_data: `sp:match_pick_score:${draft.id}:${home}:${away}` });
    }
    rows.push(row);
  }
  rows.push([
    { text: page === 0 ? 'Higher home scores' : 'Lower home scores', callback_data: `sp:match_pick_page:${draft.id}:${page === 0 ? 1 : 0}` },
  ]);
  rows.push([{ text: 'Back to Pick Draft', callback_data: `sp:match_pick_back:${draft.id}` }]);
  return { inline_keyboard: rows };
}

function renderMatchPickDraftKeyboard(draft: MatchPickDraft): TelegramInlineKeyboard {
  const rows: TelegramInlineKeyboard['inline_keyboard'] = [];
  if (!matchPickNeedsPenaltyWinner(draft) || draft.selectedPenaltyWinner) {
    rows.push([{ text: 'Approve Selected Pick', callback_data: `sp:match_pick_approve:${draft.id}` }]);
  }
  rows.push([{ text: 'Enter Score', callback_data: `sp:match_pick_choose:${draft.id}` }]);
  if (matchPickNeedsPenaltyWinner(draft)) {
    rows.push(renderMatchPickPenaltyChoiceRow(draft));
  }
  rows.push([{ text: 'Reset to Agent Pick', callback_data: `sp:match_pick_reset:${draft.id}` }]);
  rows.push([{ text: 'Cancel', callback_data: 'sp:cancel' }]);
  return { inline_keyboard: rows };
}

function renderMatchPickPenaltyKeyboard(draft: MatchPickDraft): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      renderMatchPickPenaltyChoiceRow(draft),
      [{ text: 'Enter Score Again', callback_data: `sp:match_pick_choose:${draft.id}` }],
      [{ text: 'Cancel', callback_data: 'sp:cancel' }],
    ],
  };
}

function renderMatchPickPenaltyChoiceRow(draft: MatchPickDraft): TelegramInlineKeyboard['inline_keyboard'][number] {
  return [
    { text: `${draft.decision.match.home} on penalties`, callback_data: `sp:match_pick_penalty:${draft.id}:home` },
    { text: `${draft.decision.match.away} on penalties`, callback_data: `sp:match_pick_penalty:${draft.id}:away` },
  ];
}

function renderMatchPickSelectedSlate(draft: MatchPickDraft): string {
  const score = `${draft.decision.match.home} ${draft.selectedScore.home}-${draft.selectedScore.away} ${draft.decision.match.away}`;
  const penalty = draft.selectedPenaltyWinner
    ? `Penalty winner: ${draft.selectedPenaltyWinner === 'Home' ? draft.decision.match.home : draft.decision.match.away}`
    : matchPickNeedsPenaltyWinner(draft)
      ? 'Penalty winner: choose one before approval'
      : 'Penalty winner: not needed';
  return ['Selected pick', `- Score: ${score}`, `- ${penalty}`].join('\n');
}

function matchPickNeedsPenaltyWinner(draft: MatchPickDraft): boolean {
  return draft.selectedScore.home === draft.selectedScore.away && isKnockoutMatchPhase(draft.decision.match.phase);
}

function isKnockoutMatchPhase(phase: string): boolean {
  const normalized = phase.toLowerCase();
  if (normalized.includes('group')) return false;
  return (
    normalized.includes('round') ||
    normalized.includes('quarter') ||
    normalized.includes('semi') ||
    normalized.includes('final') ||
    normalized.includes('third')
  );
}

function renderExportReportKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Markdown', callback_data: 'sp:personal_export:markdown' },
        { text: 'JSON', callback_data: 'sp:personal_export:json' },
      ],
      [{ text: 'Back to Reports', callback_data: 'sp:section:reports' }],
      [{ text: 'Main Menu', callback_data: 'sp:menu' }],
    ],
  };
}

function savedDecisionExists(decisionId: string): boolean {
  return Boolean(new MemoryStore().getDecision(decisionId));
}

function saveNaturalLanguageTelemetry(
  message: TelegramMessage,
  parsed: TelegramNaturalLanguageParsedIntent,
  actionTaken: ParserTelemetryActionTaken,
  safetyOutcome: ParserTelemetrySafetyOutcome,
  details: Record<string, unknown> = {},
): void {
  const rawText = message.text ?? '';
  const createdAt = new Date().toISOString();
  const entry: StoredParserTelemetry = {
    id: `parser-telegram-${createdAt.replace(/[:.]/g, '-')}-${hashText(`${message.chat.id}:${message.message_id}:${rawText}`).slice(2, 14)}`,
    createdAt,
    transport: 'telegram',
    rawTextHash: hashText(rawText),
    rawTextLength: rawText.length,
    chatHash: hashNullable(String(message.chat.id)),
    userHash: message.from ? hashNullable(String(message.from.id)) : null,
    parsedIntent: parsed.intent,
    parsedPermission: parsed.permission,
    parsedSafety: parsed.safety,
    slots: { ...parsed.slots },
    confidence: parsed.confidence,
    missingRequiredSlots: parsed.missingRequiredSlots,
    ambiguousSlots: parsed.ambiguousSlots,
    actionTaken,
    safetyOutcome,
    details,
  };

  try {
    new MemoryStore().saveParserTelemetry(entry);
  } catch (error) {
    console.error('Failed to store natural-language parser telemetry:', error);
  }
}

function hashNullable(value: string | null | undefined): `0x${string}` | null {
  if (value === null || value === undefined || value.length === 0) return null;
  return hashText(value);
}

function hashText(value: string): `0x${string}` {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function renderPolicyKeyboard(): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: 'Read Only', callback_data: 'sp:operator_policy:read_only' },
        { text: 'Approval Required', callback_data: 'sp:operator_policy:approval_required' },
      ],
      [
        { text: 'Claim Only', callback_data: 'sp:operator_policy:claim_only' },
        { text: 'Autopilot', callback_data: 'sp:operator_policy:tournament_autopilot' },
      ],
      [{ text: 'Back to Menu', callback_data: 'sp:menu' }],
    ],
  };
}

function renderExposureStakeLimits(config: AgentConfig): string {
  const storedOpenPlanExposurePlanck = sumStoredOpenExposure(
    new MemoryStore().listTransactionPlans(),
    config.wallet.hexAddress,
  );

  return [
    renderFriendlyExposureStakeLimits(config, storedOpenPlanExposurePlanck),
    personalSafetyLine(),
  ].join('\n\n');
}

function sumStoredOpenExposure(plans: StoredTransactionPlan[], wallet: string): string {
  const walletLower = wallet.toLowerCase();
  const total = plans.reduce((sum, plan) => {
    if (plan.wallet.toLowerCase() !== walletLower) return sum;
    if (plan.kind !== 'PlaceBet' && plan.kind !== 'SubmitPodiumPick') return sum;
    if (plan.status === 'blocked' || plan.status === 'failed' || plan.status === 'cancelled') return sum;
    return sum + BigInt(plan.valuePlanck || '0');
  }, 0n);
  return total.toString();
}

function isPreferenceDefaultsSubject(value: string): value is PreferenceDefaultsSubject {
  return value === 'risk' || value === 'objective' || value === 'strategy';
}

function isWizardRisk(value: string): value is WizardRisk {
  return (
    value === 'conservative' ||
    value === 'balanced' ||
    value === 'contrarian' ||
    value === 'catch_up' ||
    value === 'protect_lead' ||
    value === 'final_swing'
  );
}

function isPersonalReportExportFormat(value: string): value is PersonalReportExportFormat {
  return value === 'markdown' || value === 'json';
}

function buildTelegramExportFilename(input: {
  tournamentId: string;
  format: PersonalReportExportFormat;
  decisionIds: string[];
}): string {
  const extension = input.format === 'markdown' ? 'md' : 'json';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const firstDecision = input.decisionIds[0]?.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 48) ?? 'reports';
  const safeTournament = input.tournamentId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  return `smartpredictor-${safeTournament}-${firstDecision}-${timestamp}.${extension}`;
}

function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function parseTelegramWalletArg(text: string): ActorId | null {
  for (const token of text.trim().split(/\s+/)) {
    const separatorIndex = token.includes(':') ? token.indexOf(':') : token.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = token.slice(0, separatorIndex).trim().toLowerCase();
    const value = token.slice(separatorIndex + 1).trim();
    const wallet = normalizePublicWalletAddress(value);
    if ((key === 'wallet' || key === 'address') && wallet) return wallet;
  }
  return null;
}

function normalizePublicWalletAddress(value: string): ActorId | null {
  const trimmed = value.trim();
  if (/\b(mnemonic|seed phrase|private key|secret key|wallet json|keystore|browser session)\b/i.test(trimmed)) {
    return null;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? (trimmed.toLowerCase() as ActorId) : null;
}

function wizardKey(chatId: number | string, from: TelegramFrom | undefined): string {
  return `${chatId}:${from?.id ?? 'unknown'}`;
}

function shouldRunPredictionAlertScan(config: AgentConfig, nowMs: number, lastScanAtMs: number): boolean {
  if (!config.telegram.predictionAlertsEnabled) return false;
  if (resolvePredictionAlertChatIds(config).length === 0) return false;
  if (config.telegram.predictionAlertLeadMinutes <= 0) return false;
  return lastScanAtMs === 0 || nowMs - lastScanAtMs >= config.telegram.predictionAlertScanMs;
}

function startPredictionAlertScheduler(config: AgentConfig): void {
  if (!config.telegram.predictionAlertsEnabled) return;
  if (resolvePredictionAlertChatIds(config).length === 0) {
    console.log('Telegram prediction alerts disabled: no alert chat ids or admin ids configured.');
    return;
  }
  console.log(
    `Telegram prediction alerts enabled: lead=${config.telegram.predictionAlertLeadMinutes}min scan=${config.telegram.predictionAlertScanMs}ms`,
  );
  void runPredictionAlertScan(config).catch((error) => {
    console.error('Initial Telegram prediction alert scan failed:', error);
  });
  setInterval(() => {
    void runPredictionAlertScan(config).catch((error) => {
      console.error('Telegram prediction alert scan failed:', error);
    });
  }, config.telegram.predictionAlertScanMs).unref();
}

async function runPredictionAlertScan(config: AgentConfig): Promise<void> {
  if (!config.telegram.predictionAlertsEnabled) return;
  if (resolvePredictionAlertChatIds(config).length === 0) return;

  const tournaments = await listTournamentProfileOptions(config.artifacts.tournamentProfilePath);
  const memory = new MemoryStore();
  let sentCount = 0;
  for (const tournament of tournaments) {
    try {
      const report = await buildEligibleMatchPlanForWallet({
        config,
        tournamentProfilePath: tournament.path,
        wallet: config.wallet.hexAddress,
      });
      const alerts = buildDuePredictionClosingAlerts({
        config,
        memory,
        tournament,
        plan: report.plan,
      });
      for (const alert of alerts) {
        await sendTelegramMessage(config, alert.chatId, alert.text);
        memory.saveTelegramPredictionAlert(alert.record);
        sentCount += 1;
      }
    } catch (error) {
      console.error(`Prediction alert scan skipped tournament ${tournament.tournamentId}:`, error);
    }
  }
  if (sentCount > 0) console.log(`Telegram prediction alert scan sent ${sentCount} reminder(s).`);
}

async function sendTelegramMessage(
  config: AgentConfig,
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramInlineKeyboard,
): Promise<void> {
  await telegramApi(config, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function sendTelegramDocument(
  config: AgentConfig,
  chatId: number | string,
  input: {
    filename: string;
    content: string;
    mimeType: string;
    caption?: string;
  },
): Promise<void> {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (input.caption) form.set('caption', input.caption.slice(0, 1024));
  form.set('document', new Blob([input.content], { type: input.mimeType }), input.filename);
  await telegramMultipartApi(config, 'sendDocument', form);
}

async function syncTelegramPublicCommands(config: AgentConfig): Promise<void> {
  try {
    await telegramApi(config, 'setMyCommands', {
      commands: TELEGRAM_PUBLIC_COMMANDS,
      scope: { type: 'default' },
    });
    console.log(`Telegram public command menu synced: ${TELEGRAM_PUBLIC_COMMANDS.length} command(s).`);
  } catch (error) {
    console.error('Telegram public command menu sync failed; continuing bot startup:', error);
  }
}

async function sendTelegramLongMessage(
  config: AgentConfig,
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramInlineKeyboard,
): Promise<void> {
  const parts = splitTelegramMessage(text);
  for (const [index, part] of parts.entries()) {
    await sendTelegramMessage(
      config,
      chatId,
      part,
      index === parts.length - 1 ? replyMarkup : undefined,
    );
  }
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_SAFE_MESSAGE_LENGTH) return [text];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= TELEGRAM_SAFE_MESSAGE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    if (line.length <= TELEGRAM_SAFE_MESSAGE_LENGTH) {
      current = line;
      continue;
    }
    for (let index = 0; index < line.length; index += TELEGRAM_SAFE_MESSAGE_LENGTH) {
      parts.push(line.slice(index, index + TELEGRAM_SAFE_MESSAGE_LENGTH));
    }
    current = '';
  }
  if (current) parts.push(current);
  return parts.length ? parts : [''];
}

async function npmRunCli(args: string[]): Promise<string> {
  const [command, separator, ...rest] = args;
  if (!command) throw new Error('Internal CLI command is missing.');
  const cliArgs = separator === '--' ? [command, ...rest] : args;
  const { stdout, stderr } = await execFileAsync(process.execPath, ['dist/cli.js', ...cliArgs], {
    cwd: process.cwd(),
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return [stdout, stderr].filter(Boolean).join('\n');
}

function extractJsonPayload<T>(output: string): T | null {
  const first = output.indexOf('{');
  const last = output.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(output.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}

function telegramUserContext(from: TelegramFrom | undefined): TelegramUserContext {
  if (!from) return { id: 'unknown' };
  const user: TelegramUserContext = { id: from.id };
  if (from.username) user.username = from.username;
  if (from.first_name) user.firstName = from.first_name;
  return user;
}

async function telegramApi<T>(config: AgentConfig, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  });
  const body = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram ${method} failed: ${body.description ?? response.statusText}`);
  }
  return body.result as T;
}

async function telegramMultipartApi<T>(config: AgentConfig, method: string, form: FormData): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  });
  const body = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram ${method} failed: ${body.description ?? response.statusText}`);
  }
  return body.result as T;
}

function pollingBackoffMs(consecutiveFailures: number): number {
  const exponential = Math.min(POLLING_MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, consecutiveFailures - 1));
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function enqueueWebhookUpdate(task: () => Promise<void>): Promise<void> {
  const run = webhookUpdateQueue.then(task, task);
  webhookUpdateQueue = run.catch(() => undefined);
  await run;
}

function printTelegramDryRun(config: AgentConfig): void {
  console.log(`Telegram mode: ${config.telegram.mode}`);
  console.log(`Token configured: ${Boolean(config.telegram.botToken)}`);
  console.log(`Admin count: ${config.telegram.adminIds.length}`);
  console.log(`Webhook URL: ${config.telegram.webhookUrl ?? 'n/a'}`);
  console.log(`Webhook bind: ${config.telegram.webhookHost}:${config.telegram.webhookPort}`);
  console.log(`Webhook secret configured: ${Boolean(config.telegram.webhookSecret)}`);
  console.log(`Prediction alerts enabled: ${config.telegram.predictionAlertsEnabled}`);
  console.log(`Prediction alert lead minutes: ${config.telegram.predictionAlertLeadMinutes}`);
  console.log(`Prediction alert scan ms: ${config.telegram.predictionAlertScanMs}`);
  console.log(`Prediction alert chat count: ${resolvePredictionAlertChatIds(config).length}`);
  console.log(`Public command menu: ${TELEGRAM_PUBLIC_COMMANDS.map((command) => `/${command.command}`).join(', ')}`);
}
