import { DEFAULT_CONFIG } from './smartpredictor.js';
import type { AgentConfig, ExecutionMode, HexAddress, TelegramMode } from '../types/index.js';
import { existsSync, readFileSync } from 'node:fs';

loadDotEnv();

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var ${name}=${value}`);
  }
  return parsed;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  throw new Error(`Invalid boolean env var ${name}=${value}`);
}

function envExecutionMode(name: string, fallback: ExecutionMode): ExecutionMode {
  const value = process.env[name];
  if (!value) return fallback;
  if (value === 'read_only' || value === 'approval_required' || value === 'tournament_autopilot' || value === 'claim_only') {
    return value;
  }
  throw new Error(`Invalid execution mode ${name}=${value}`);
}

function envTelegramMode(name: string, fallback: TelegramMode): TelegramMode {
  const value = process.env[name];
  if (!value) return fallback;
  if (value === 'polling' || value === 'webhook') return value;
  throw new Error(`Invalid Telegram mode ${name}=${value}`);
}

function envCsv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): AgentConfig {
  const config: AgentConfig = {
    ...DEFAULT_CONFIG,
    agent: {
      ...DEFAULT_CONFIG.agent,
      handle: process.env.SMARTPREDICTOR_HANDLE ?? DEFAULT_CONFIG.agent.handle,
      name: process.env.SMARTPREDICTOR_NAME ?? DEFAULT_CONFIG.agent.name,
    },
    wallet: {
      ...DEFAULT_CONFIG.wallet,
      accountName: process.env.SMARTPREDICTOR_WALLET_ACCOUNT ?? DEFAULT_CONFIG.wallet.accountName,
      hexAddress: (process.env.SMARTPREDICTOR_WALLET_HEX ?? DEFAULT_CONFIG.wallet.hexAddress) as HexAddress,
      ss58Address: process.env.SMARTPREDICTOR_WALLET_SS58 ?? DEFAULT_CONFIG.wallet.ss58Address,
    },
    network: {
      ...DEFAULT_CONFIG.network,
      name: (process.env.VARA_NETWORK ?? DEFAULT_CONFIG.network.name) as AgentConfig['network']['name'],
      rpcUrl: process.env.VARA_RPC_URL ?? DEFAULT_CONFIG.network.rpcUrl,
    },
    programs: {
      ...DEFAULT_CONFIG.programs,
      bolaoCore: (process.env.SMARTCUP_BOLAO_CORE_ID ?? DEFAULT_CONFIG.programs.bolaoCore) as HexAddress,
      oracle: (process.env.SMARTCUP_ORACLE_ID ?? DEFAULT_CONFIG.programs.oracle) as HexAddress,
      freebetLedger: (process.env.SMARTCUP_FREEBET_LEDGER_ID ||
        DEFAULT_CONFIG.programs.freebetLedger) as HexAddress | null,
    },
    services: {
      ...DEFAULT_CONFIG.services,
      fixtureProvider: (process.env.SMARTCUP_FIXTURE_PROVIDER ?? DEFAULT_CONFIG.services.fixtureProvider) as AgentConfig['services']['fixtureProvider'],
      oddsProvider: (process.env.SMARTCUP_ODDS_PROVIDER ?? DEFAULT_CONFIG.services.oddsProvider) as AgentConfig['services']['oddsProvider'],
      footballContextProvider: (process.env.SMARTCUP_FOOTBALL_CONTEXT_PROVIDER ??
        DEFAULT_CONFIG.services.footballContextProvider) as AgentConfig['services']['footballContextProvider'],
      smartcupApiUrl: process.env.SMARTCUP_API_URL ?? DEFAULT_CONFIG.services.smartcupApiUrl,
      indexerGraphqlUrl: process.env.SMARTCUP_INDEXER_GRAPHQL_URL ?? DEFAULT_CONFIG.services.indexerGraphqlUrl,
      indexerGraphqlTimeoutMs: envNumber(
        'SMARTCUP_INDEXER_GRAPHQL_TIMEOUT_MS',
        DEFAULT_CONFIG.services.indexerGraphqlTimeoutMs,
      ),
      footballDataBaseUrl: process.env.FOOTBALL_DATA_BASE_URL ?? DEFAULT_CONFIG.services.footballDataBaseUrl,
      footballDataApiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? DEFAULT_CONFIG.services.footballDataApiToken,
      manualOddsJson: process.env.SMARTCUP_ODDS_MANUAL_JSON ?? DEFAULT_CONFIG.services.manualOddsJson,
      manualFootballContextJson:
        process.env.SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON ?? DEFAULT_CONFIG.services.manualFootballContextJson,
    },
    artifacts: {
      bolaoIdlPath: process.env.SMARTCUP_BOLAO_IDL_PATH ?? DEFAULT_CONFIG.artifacts.bolaoIdlPath,
      freebetLedgerIdlPath:
        process.env.SMARTCUP_FREEBET_LEDGER_IDL_PATH ?? DEFAULT_CONFIG.artifacts.freebetLedgerIdlPath,
      oracleIdlPath: process.env.SMARTCUP_ORACLE_IDL_PATH ?? DEFAULT_CONFIG.artifacts.oracleIdlPath,
      tournamentProfilePath:
        process.env.SMARTCUP_TOURNAMENT_PROFILE_PATH ?? DEFAULT_CONFIG.artifacts.tournamentProfilePath,
    },
    economics: {
      matchWinnerPoolBps: envNumber('SMARTCUP_MATCH_WINNER_POOL_BPS', DEFAULT_CONFIG.economics.matchWinnerPoolBps),
      finalPrizePoolBps: envNumber('SMARTCUP_FINAL_PRIZE_POOL_BPS', DEFAULT_CONFIG.economics.finalPrizePoolBps),
      protocolFeeBps: envNumber('SMARTCUP_PROTOCOL_FEE_BPS', DEFAULT_CONFIG.economics.protocolFeeBps),
    },
    policy: {
      mode: envExecutionMode('SMARTPREDICTOR_POLICY_MODE', DEFAULT_CONFIG.policy.mode),
      cutoffBufferMs: envNumber('SMARTPREDICTOR_CUTOFF_BUFFER_MS', DEFAULT_CONFIG.policy.cutoffBufferMs),
      minStakeUsd: process.env.SMARTPREDICTOR_MIN_STAKE_USD ?? DEFAULT_CONFIG.policy.minStakeUsd,
      maxStakePlanck: process.env.SMARTPREDICTOR_MAX_STAKE_PLANCK ?? DEFAULT_CONFIG.policy.maxStakePlanck,
      maxTournamentExposurePlanck: process.env.SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_PLANCK ?? DEFAULT_CONFIG.policy.maxTournamentExposurePlanck,
      maxStakeUsd: process.env.SMARTPREDICTOR_MAX_STAKE_USD ?? DEFAULT_CONFIG.policy.maxStakeUsd,
      maxTournamentExposureUsd:
        process.env.SMARTPREDICTOR_MAX_TOURNAMENT_EXPOSURE_USD ??
        DEFAULT_CONFIG.policy.maxTournamentExposureUsd,
      approvalFlowVerified: envBoolean(
        'SMARTPREDICTOR_APPROVAL_FLOW_VERIFIED',
        DEFAULT_CONFIG.policy.approvalFlowVerified,
      ),
      liveSmokeVerified: envBoolean(
        'SMARTPREDICTOR_LIVE_SMOKE_VERIFIED',
        DEFAULT_CONFIG.policy.liveSmokeVerified,
      ),
      liveSmokeReference:
        process.env.SMARTPREDICTOR_LIVE_SMOKE_REFERENCE ?? DEFAULT_CONFIG.policy.liveSmokeReference,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || DEFAULT_CONFIG.telegram.botToken,
      adminIds: envCsv('TELEGRAM_ADMIN_IDS', DEFAULT_CONFIG.telegram.adminIds),
      mode: envTelegramMode('TELEGRAM_MODE', DEFAULT_CONFIG.telegram.mode),
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || DEFAULT_CONFIG.telegram.webhookUrl,
      webhookHost: process.env.TELEGRAM_WEBHOOK_HOST || DEFAULT_CONFIG.telegram.webhookHost,
      webhookPort: envNumber('TELEGRAM_WEBHOOK_PORT', DEFAULT_CONFIG.telegram.webhookPort),
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || DEFAULT_CONFIG.telegram.webhookSecret,
      publicBotName: process.env.SMARTPREDICTOR_PUBLIC_BOT_NAME ?? DEFAULT_CONFIG.telegram.publicBotName,
      predictionAlertsEnabled: envBoolean(
        'TELEGRAM_PREDICTION_ALERTS_ENABLED',
        DEFAULT_CONFIG.telegram.predictionAlertsEnabled,
      ),
      predictionAlertLeadMinutes: envNumber(
        'TELEGRAM_PREDICTION_ALERT_LEAD_MINUTES',
        DEFAULT_CONFIG.telegram.predictionAlertLeadMinutes,
      ),
      predictionAlertScanMs: envNumber(
        'TELEGRAM_PREDICTION_ALERT_SCAN_MS',
        DEFAULT_CONFIG.telegram.predictionAlertScanMs,
      ),
      predictionAlertChatIds: envCsv(
        'TELEGRAM_PREDICTION_ALERT_CHAT_IDS',
        DEFAULT_CONFIG.telegram.predictionAlertChatIds,
      ),
    },
  };
  assertBolaoIdlProgramCompatibility(config);
  return config;
}

export { DEFAULT_CONFIG };

function assertBolaoIdlProgramCompatibility(config: AgentConfig): void {
  const idlPath = config.artifacts.bolaoIdlPath.toLowerCase();
  const isFreebetV4Idl = idlPath.endsWith('bolao_program.freebet-v4.idl') || idlPath.includes('freebet-v4');
  const isCurrentWorldCupMvpProgram =
    config.programs.bolaoCore.toLowerCase() === DEFAULT_CONFIG.programs.bolaoCore.toLowerCase();
  const allowOverride = envBoolean('SMARTCUP_ALLOW_BOLAO_IDL_COMPATIBILITY_OVERRIDE', false);

  if (isFreebetV4Idl && isCurrentWorldCupMvpProgram && !allowOverride) {
    throw new Error(
      [
        'Incompatible BolaoCore IDL/program pair.',
        'The current World Cup MVP BolaoCore program returns the deployed 5-field UserBetView.',
        'artifacts/idl/bolao_program.freebet-v4.idl expects the newer 6-field freebet-aware UserBetView and will misdecode QueryBetsByUser rows.',
        'Use SMARTCUP_BOLAO_IDL_PATH=artifacts/idl/bolao_program.idl with the current program, or update SMARTCUP_BOLAO_CORE_ID together with the matching upgraded freebet BolaoCore program.',
        'Set SMARTCUP_ALLOW_BOLAO_IDL_COMPATIBILITY_OVERRIDE=true only for a deliberate protocol-migration smoke test.',
      ].join(' '),
    );
  }
}

export type ReusableSetupGuardReport = {
  productionMode: boolean;
  guardEnabled: boolean;
  allowDefaultIdentity: boolean;
  ready: boolean;
  defaultIdentityInUse: boolean;
  reusableCloneReady: boolean;
  checks: {
    adminIdsConfigured: boolean;
    walletChangedFromTemplate: boolean;
    botNameChangedFromTemplate: boolean;
  };
  missing: string[];
  recommendations: string[];
  message: string;
};

export function buildReusableSetupGuardReport(config: AgentConfig): ReusableSetupGuardReport {
  const productionMode = process.env.NODE_ENV === 'production';
  const guardEnabled = envBoolean('SMARTPREDICTOR_REUSABLE_SETUP_GUARD', true);
  const allowDefaultIdentity = envBoolean('SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY', false);
  const adminIdsConfigured = config.telegram.adminIds.length > 0;
  const walletChangedFromTemplate =
    config.wallet.hexAddress !== DEFAULT_CONFIG.wallet.hexAddress &&
    config.wallet.ss58Address !== DEFAULT_CONFIG.wallet.ss58Address;
  const botNameChangedFromTemplate =
    config.telegram.publicBotName !== DEFAULT_CONFIG.telegram.publicBotName ||
    config.agent.name !== DEFAULT_CONFIG.agent.name;
  const defaultIdentityInUse = !walletChangedFromTemplate && !botNameChangedFromTemplate;
  const missing: string[] = [];

  if (!adminIdsConfigured) missing.push('set TELEGRAM_ADMIN_IDS to at least one numeric operator user id');
  if (!allowDefaultIdentity && !walletChangedFromTemplate) {
    missing.push('replace SMARTPREDICTOR_WALLET_HEX and SMARTPREDICTOR_WALLET_SS58 with the operator wallet');
  }
  if (!allowDefaultIdentity && !botNameChangedFromTemplate) {
    missing.push('replace SMARTPREDICTOR_PUBLIC_BOT_NAME or SMARTPREDICTOR_NAME');
  }

  const ready = !guardEnabled || (adminIdsConfigured && (allowDefaultIdentity || (walletChangedFromTemplate && botNameChangedFromTemplate)));
  const reusableCloneReady = adminIdsConfigured && walletChangedFromTemplate && botNameChangedFromTemplate;
  const recommendations = guardEnabled ? [] : missing;
  return {
    productionMode,
    guardEnabled,
    allowDefaultIdentity,
    ready,
    defaultIdentityInUse,
    reusableCloneReady,
    checks: {
      adminIdsConfigured,
      walletChangedFromTemplate,
      botNameChangedFromTemplate,
    },
    missing: guardEnabled ? missing : [],
    recommendations,
    message: ready
      ? defaultIdentityInUse
        ? 'Template setup acknowledged with default placeholder identity. Replace wallet, bot name, and admin id before real use.'
        : 'Reusable setup guard passed.'
      : `Reusable setup guard failed: ${missing.join('; ')}.`,
  };
}

export function assertReusableProductionSetup(config: AgentConfig): void {
  const report = buildReusableSetupGuardReport(config);
  if (!report.productionMode || report.ready) return;
  throw new Error(
    [
      report.message,
      'This prevents cloned deployments from running in production while still using template/default identity values.',
      'Set SMARTPREDICTOR_ALLOW_DEFAULT_IDENTITY=true only for deliberate local documentation/demo smoke runs.',
      'Reusable user deployments should change wallet, Telegram admin id, and bot name instead.',
    ].join(' '),
  );
}

function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  const loadedFromFile = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    if (!(key in process.env) || loadedFromFile.has(key)) {
      process.env[key] = value;
      loadedFromFile.add(key);
    }
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
