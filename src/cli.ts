import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { AccountReadinessAdapter } from './adapters/account-readiness.js';
import { BolaoChainClient } from './adapters/bolao-chain-client.js';
import { buildEligibleMatchPlanForWallet } from './adapters/eligible-match-plan.js';
import { FootballDataAdapter } from './adapters/football-data-adapter.js';
import { IndexerAdapter } from './adapters/indexer-adapter.js';
import { OpponentFeatureAdapter } from './adapters/opponent-feature-adapter.js';
import { PoolDistributionAdapter } from './adapters/pool-distribution-adapter.js';
import { buildReusableSetupGuardReport, loadConfig } from './config/index.js';
import {
  adminCommands,
  buildTelegramNaturalLanguageClarification,
  buildTelegramPreference,
  userCommands,
  applyStoredPolicyOverride,
  applyOperatorPreferencesToCommandText,
  parseTelegramNaturalLanguage,
  renderMenuSectionKeyboard,
  renderMenuSectionText,
  resolveTelegramMessageRoute,
  runTelegramBot,
  TelegramPermissionModel,
} from './bot/index.js';
import { renderFriendlyPersonalBundle } from './bot/friendly-bundle-renderer.js';
import { renderFriendlyPredictionPreview } from './bot/friendly-prediction-renderer.js';
import { renderFriendlySourceFallback } from './bot/friendly-source-fallback-renderer.js';
import { buildDuePredictionClosingAlerts } from './bot/prediction-alerts.js';
import { evaluateBalanceExposure } from './executor/balance-exposure-guard.js';
import { ConfirmationReadbackAdvisor } from './executor/confirmation-readback.js';
import { evaluateCutoffBuffer } from './executor/cutoff-buffer-guard.js';
import { executeTransactionPlan } from './executor/live-transaction-executor.js';
import { evaluatePlaceBetPayload } from './executor/place-bet-payload-guard.js';
import {
  buildClaimRefundTransactionPlan,
  buildClaimFinalPrizeTransactionPlan,
  buildClaimMatchRewardTransactionPlan,
  buildPlaceBetTransactionPlan,
  buildSpendFreebetTransactionPlan,
  buildSubmitPodiumPickTransactionPlan,
} from './executor/transaction-plan-builder.js';
import { FreebetLedgerClient } from './adapters/freebet-ledger-client.js';
import { buildFreebetStatusReport, renderFreebetStatusSummary } from './freebet/index.js';
import { buildOnboardingWizardReport, renderOnboardingWizardSummary } from './onboarding/index.js';
import { reconcileChainPredictions } from './predictions/index.js';
import { buildRefundStatusReport, renderRefundStatusSummary } from './refund/index.js';
import {
  buildPersonalReportExport,
  buildPersonalSavedReportLookup,
  renderPersonalSavedReportLookupSummary,
  renderPersonalReportExportSummary,
  type PersonalSavedReportProduct,
} from './reports/index.js';
import {
  buildDecisionForMatch,
  buildPersonalPodiumStrategyReport,
  buildPersonalTournamentAdvisoryReport,
  renderPodiumStrategySummary,
  renderTournamentAdvisorySummary,
} from './strategy/index.js';
import { MemoryStore } from './memory/memory-store.js';
import { jsonStringify } from './memory/json-safe.js';
import {
  CrowdModel,
  ForecastModel,
  LeaderboardModel,
  MonteCarloLeaderboardModel,
  OpponentAwareOutputModel,
  OpponentSamplerModel,
  PayoutEvModel,
  PointsEvModel,
  PostMatchCalibrationModel,
  RiskModeModel,
  renderPostMatchCalibrationSummary,
  TeamRatingModel,
} from './models/index.js';
import { listTournamentProfileOptions, loadTournamentProfile, reconcileTournamentProfileWithChain } from './tournament/index.js';
import {
  formatUsdAmount,
  formatVaraUsdPrice,
  planckToUsdString,
  planckToVaraString,
  usdToPlanck,
  type VaraUsdPriceSource,
} from './economics/vara-usd-converter.js';
import type { ScoreMatrixForecast } from './models/forecast-model.js';
import type {
  BolaoMatch,
  ActorId,
  AlternativePickSetReport,
  CandidatePayoutEvReport,
  CandidatePointsEvReport,
  ConfidenceDegradationReport,
  CrowdContrarianMapReport,
  DecisionReport,
  FootballContextRiskReport,
  FootballDataFixtureQuery,
  FundingSource,
  HexAddress,
  MarketOddsComparisonReport,
  MatchPoolDistributionView,
  MatchStatus,
  MonteCarloLeaderboardSimulationReport,
  OpponentAwareOutputReport,
  OpponentPredictionSamplerReport,
  PenaltyWinner,
  PoolOutcome,
  ProviderMatchStatus,
  RiskMode,
  RiskModeEvaluationReport,
  Score,
  SmartCupMatch,
  SourceQualityReport,
  TimingStrategyReport,
  TournamentPositionStrategyReport,
  StoredOutcomeEvaluation,
  StoredPrediction,
  StoredTelegramPreference,
  StoredTransactionPlan,
  StoredTransactionResult,
  TransactionKind,
  TournamentProfile,
  IoSmartCupState,
  ParserTelemetryActionTaken,
  ParserTelemetrySafetyOutcome,
  StoredParserTelemetry,
} from './types/index.js';

type Command =
  | 'setup-check'
  | 'sync'
  | 'profile'
  | 'recommend'
  | 'team-rating'
  | 'football-data'
  | 'pool'
  | 'crowd'
  | 'ev'
  | 'points'
  | 'leaderboard'
  | 'opponents'
  | 'sample-opponents'
  | 'simulate'
  | 'decide'
  | 'market'
  | 'timing'
  | 'crowd-map'
  | 'context-risk'
  | 'position-strategy'
  | 'alternatives'
  | 'podium'
  | 'advisory'
  | 'plan-open-matches'
  | 'onboarding'
  | 'reconcile-predictions'
  | 'submit'
  | 'evaluate'
  | 'claim'
  | 'freebet'
  | 'refund'
  | 'report'
  | 'calibration'
  | 'list-reports'
  | 'export-report'
  | 'telegram-config'
  | 'telegram-nl-smoke'
  | 'telegram-private-smoke'
  | 'telegram-bot'
  | 'help';

const commands: Record<Command, string> = {
  'setup-check': 'Check reusable production setup guard for wallet, admin id, and bot identity.',
  sync: 'Read SmartCup chain/indexer/API state and update local memory.',
  profile: 'Load tournament profile and reconcile live BolaoCore phases.',
  recommend: 'Generate a DecisionReport for a match.',
  'team-rating': 'Inspect deterministic team ratings for a match or pair of teams.',
  'football-data': 'Fetch normalized football-data.org fixtures/results.',
  pool: 'Inspect SmartCup pool distribution and 85/10/5 entry split.',
  crowd: 'Estimate exact-score crowding from visible outcome pools.',
  ev: 'Compute candidate exact-score payout EV.',
  points: 'Compute candidate SmartCup points EV with phase weights.',
  leaderboard: 'Simulate candidate top-5 final-prize equity.',
  opponents: 'Import opponent leaderboard and bet-history features.',
  'sample-opponents': 'Sample opponent predictions from archetypes and match signals.',
  simulate: 'Run Monte Carlo leaderboard simulation for candidate scores.',
  decide: 'Emit a full SmartCup DecisionReport for one match.',
  market: 'Compare agent probabilities against bookmaker implied probabilities for one match.',
  timing: 'Analyze whether to predict now or wait closer to kickoff for one match.',
  'crowd-map': 'Show public score clusters and differentiated contrarian opportunities for one match.',
  'context-risk': 'Show lineup, injury, suspension, and news-risk freshness/uncertainty for one match.',
  'position-strategy': 'Recommend tournament posture from rank, points gap, and phase weight for one match.',
  alternatives: 'Show safest, balanced, contrarian, and leaderboard-upside picks for one match.',
  podium: 'Build a personal champion/runner-up/third-place podium strategy report.',
  advisory: 'Build a personal rolling tournament advisory report.',
  'plan-open-matches': 'List eligible matches ordered by cutoff urgency.',
  onboarding: 'Run a guided onboarding wizard for wallet, profile, freebet, eligible matches, and first prediction.',
  'reconcile-predictions': 'Replace local historical wallet prediction memory with current chain truth for manual/imported rows.',
  submit: 'Submit an approved transaction plan after safety checks.',
  evaluate: 'Store result, payout, points, and error classification for a decision.',
  claim: 'Find and claim eligible rewards under policy.',
  freebet: 'Inspect freebet balance, ledger authorization, usage, and Oracle price status.',
  refund: 'Inspect pending cancelled-match refunds and plan guarded ClaimRefund calls.',
  report: 'Show prediction history and evaluation summaries.',
  calibration: 'Compare evaluated DecisionReports against finalized results with Brier/log-loss metrics.',
  'list-reports': 'List saved personal DecisionReports with tournament/match/product/risk/date filters.',
  'export-report': 'Export saved personal DecisionReports as Markdown or JSON.',
  'telegram-config': 'Inspect Telegram bot config and permission decisions.',
  'telegram-nl-smoke': 'Parse Telegram natural-language messages locally without contacting Telegram.',
  'telegram-private-smoke': 'Run private Telegram natural-language safety smoke assertions locally.',
  'telegram-bot': 'Run the live Telegram bot in polling or webhook mode.',
  help: 'Show available commands.',
};

function printHelp(): void {
  console.log('SmartCup Prediction Agent CLI');
  console.log('');
  for (const [name, description] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(18)} ${description}`);
  }
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'help') as Command;
  const topLevelArgs = parseArgs(process.argv.slice(3));

  if (command === 'help' || !(command in commands)) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const policyOverride = command === 'telegram-private-smoke'
    ? { applied: false, policy: null }
    : applyStoredPolicyOverride(config);
  const quietJson =
    (command === 'decide' ||
      command === 'market' ||
      command === 'timing' ||
      command === 'crowd-map' ||
      command === 'context-risk' ||
      command === 'position-strategy' ||
      command === 'alternatives' ||
      command === 'podium' ||
      command === 'advisory' ||
      command === 'list-reports' ||
      command === 'export-report' ||
      command === 'freebet' ||
      command === 'refund' ||
      command === 'onboarding') &&
    (topLevelArgs.format ?? 'json') === 'json';
  if (!quietJson) {
    console.log(`[${config.agent.handle}] command=${command}`);
    console.log(`[${config.agent.handle}] wallet=${config.wallet.accountName}`);
    console.log(`[${config.agent.handle}] bolao=${config.programs.bolaoCore}`);
    if (policyOverride.applied) {
      console.log(
        `[${config.agent.handle}] runtime_policy=${policyOverride.policy?.mode} source=${policyOverride.policy?.source}`,
      );
    }
  }

  if (command === 'setup-check') {
    const args = parseArgs(process.argv.slice(3));
    const report = buildReusableSetupGuardReport(config);
    if ((args.format ?? 'summary') === 'json') {
      console.log(JSON.stringify({ reusableSetupGuard: report }, null, 2));
      return;
    }

    console.log('Reusable setup guard');
    console.log(`Production mode: ${report.productionMode}`);
    console.log(`Guard enabled: ${report.guardEnabled}`);
    console.log(`Allow default identity: ${report.allowDefaultIdentity}`);
    console.log(`Ready: ${report.ready}`);
    console.log(`Default identity in use: ${report.defaultIdentityInUse}`);
    console.log(`Reusable clone ready: ${report.reusableCloneReady}`);
    console.log(`Admin IDs configured: ${report.checks.adminIdsConfigured}`);
    console.log(`Wallet changed from template: ${report.checks.walletChangedFromTemplate}`);
    console.log(`Bot name changed from template: ${report.checks.botNameChangedFromTemplate}`);
    if (report.missing.length > 0) {
      console.log('Missing:');
      for (const item of report.missing) console.log(`- ${item}`);
    }
    if (report.recommendations.length > 0) {
      console.log(
        report.defaultIdentityInUse
          ? 'Reusable clone recommendations:'
          : 'Reusable production recommendations:',
      );
      for (const item of report.recommendations) console.log(`- ${item}`);
    }
    console.log(report.message);
    return;
  }

  if (command === 'sync') {
    const args = parseArgs(process.argv.slice(3));
    const readiness = await new AccountReadinessAdapter(config).check();
    const shouldReconcile =
      args.reconcile === 'true' || args['reconcile-predictions'] === 'true' || args['reconcile-predictions'] === '1';
    const reconciliation = shouldReconcile ? await reconcileChainPredictions(config, new MemoryStore()) : null;
    console.log(JSON.stringify({ accountReadiness: readiness, predictionReconciliation: reconciliation }, null, 2));
    return;
  }

  if (command === 'profile') {
    const profile = await loadTournamentProfile(config.artifacts.tournamentProfilePath);
    const state = await new BolaoChainClient(config).queryState();
    const reconciled = reconcileTournamentProfileWithChain(profile, state);
    console.log(
      JSON.stringify(
        {
          tournamentId: reconciled.tournamentId,
          phaseWeights: reconciled.phases.map((phase) => ({
            key: phase.key,
            name: phase.name,
            smartcupPhaseNames: phase.smartcupPhaseNames,
            pointsWeight: phase.pointsWeight,
            weightSource: phase.weightSource,
            startsAt: phase.startsAt,
            endsAt: phase.endsAt,
          })),
          cutoff: reconciled.cutoff,
          entry: reconciled.entry,
          scoring: reconciled.scoring,
          finalPrize: reconciled.finalPrize,
          podiumPick: reconciled.podiumPick,
          live: {
            chainPhaseCount: state.phases.length,
            r32LockTime: state.r32_lock_time,
            r32LockTimeIso: state.r32_lock_time ? new Date(Number(state.r32_lock_time)).toISOString() : null,
            podiumFinalized: state.podium_finalized,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'plan-open-matches') {
    const report = await buildEligibleMatchPlanForWallet({
      config,
      tournamentProfilePath: config.artifacts.tournamentProfilePath,
    });
    console.log(JSON.stringify({ eligibleMatchPlan: report.plan, sources: report.sources, warnings: report.warnings }, null, 2));
    return;
  }

  if (command === 'podium') {
    const args = parseArgs(process.argv.slice(3));
    const profile = await loadTournamentProfile(args.profile ?? config.artifacts.tournamentProfilePath);
    const generatedAt = optionalArg(args, 'generated-at');
    const report = buildPersonalPodiumStrategyReport(profile, {
      ...(generatedAt ? { generatedAt } : {}),
      pillar: 'personal_operator',
    });

    if ((args.format ?? 'json') === 'summary') {
      console.log(renderPodiumStrategySummary(report));
      return;
    }

    console.log(JSON.stringify({ podiumStrategy: report }, null, 2));
    return;
  }

  if (command === 'advisory') {
    const args = parseArgs(process.argv.slice(3));
    const profilePath = args.profile ?? config.artifacts.tournamentProfilePath;
    const profile = await loadTournamentProfile(profilePath);
    const eligibleMatchPlan = await buildEligibleMatchPlanForWallet({
      config,
      tournamentProfilePath: profilePath,
    });
    const memory = new MemoryStore(optionalArg(args, 'memory-path'), optionalArg(args, 'sqlite-path'));
    const report = buildPersonalTournamentAdvisoryReport({
      config,
      profile,
      eligibleMatchPlan,
      predictions: memory.listPredictions(),
      transactionPlans: memory.listTransactionPlans(),
      preference: {
        defaultRiskMode: args.risk ? parseRiskMode(args.risk) : profile.defaultRiskMode,
        simulationObjective: args.objective ? parseRiskMode(args.objective) : args.risk ? parseRiskMode(args.risk) : profile.defaultRiskMode,
        strategyPosture: args.strategy ? parseRiskMode(args.strategy) : args.risk ? parseRiskMode(args.risk) : profile.defaultRiskMode,
      },
      priorityLimit: Number(args.limit ?? 5),
    });

    if ((args.format ?? 'json') === 'summary') {
      console.log(renderTournamentAdvisorySummary(report));
      return;
    }

    console.log(JSON.stringify({ tournamentAdvisory: report }, null, 2));
    return;
  }

  if (command === 'onboarding') {
    const args = parseArgs(process.argv.slice(3));
    const report = await buildOnboardingWizardReport(config, {
      wallet: (optionalArg(args, 'wallet') ?? optionalArg(args, 'address') ?? config.wallet.hexAddress) as ActorId,
      matchId: optionalArg(args, 'match') ?? null,
      riskMode: args.risk ? parseRiskMode(args.risk) : 'balanced',
      fundingSource: parseWizardFundingSource(args.funding ?? args.fundingSource ?? 'auto'),
      stakePlanck: (optionalArg(args, 'stakePlanck') ?? optionalArg(args, 'stake') ?? '4500000000000000') as `${number}`,
      iterations: Number(args.iterations ?? 500),
      candidateLimit: Number(args.candidates ?? 8),
      profileLimit: Number(args.profiles ?? 50),
      opponentLimit: Number(args.limit ?? 500),
      topScores: Number(args.topScores ?? 8),
      seed: args.seed ?? 'smartcup-agent',
    });
    const shouldSave = args.save === 'true' && report.firstPrediction.decision;
    if (shouldSave && report.firstPrediction.decision) {
      new MemoryStore().saveDecision(report.firstPrediction.decision);
    }
    if ((args.format ?? 'json') === 'summary') {
      console.log(renderOnboardingWizardSummary(report));
      if (shouldSave && report.firstPrediction.decision) {
        console.log(`Saved decision report: ${report.firstPrediction.decision.id}`);
      }
    } else {
      console.log(JSON.stringify({ onboarding: report, savedDecision: shouldSave ? report.firstPrediction.decision?.id : null }, null, 2));
    }
    return;
  }

  if (command === 'reconcile-predictions') {
    const args = parseArgs(process.argv.slice(3));
    const report = await reconcileChainPredictions(config, new MemoryStore());
    if ((args.format ?? 'json') === 'summary') {
      console.log(`Wallet: ${report.wallet}`);
      console.log(`Final local prediction count: ${report.finalPredictionCount}`);
      console.log(`Removed stale records: ${report.removedPredictionIds.length}`);
      if (report.removedPredictionIds.length > 0) {
        console.log(`Removed ids: ${report.removedPredictionIds.join(', ')}`);
      }
      console.log(`Upserted records: ${report.upsertedPredictions.length}`);
      for (const prediction of report.upsertedPredictions) {
        console.log(
          `- ${prediction.matchId} ${prediction.score.home}-${prediction.score.away} ${prediction.predictedOutcome} source=${prediction.source}`,
        );
      }
      for (const note of report.notes) console.log(`Note: ${note}`);
    } else {
      console.log(JSON.stringify({ predictionReconciliation: report }, null, 2));
    }
    return;
  }

  if (command === 'team-rating') {
    const args = parseArgs(process.argv.slice(3));
    const model = new TeamRatingModel();
    const matchId = args.match;

    if (matchId) {
      const match = await new BolaoChainClient(config).queryMatch(matchId);
      if (!match) throw new Error(`Match not found: ${matchId}`);
      console.log(
        JSON.stringify(
          {
            matchId: match.match_id,
            home: match.home,
            away: match.away,
            rating: model.rateMatch({ home: match.home, away: match.away }),
          },
          null,
          2,
        ),
      );
      return;
    }

    const home = args.home;
    const away = args.away;
    if (!home || !away) {
      throw new Error('team-rating requires --match <id> or --home <team> --away <team>.');
    }

    console.log(JSON.stringify({ home, away, rating: model.rateMatch({ home, away }) }, null, 2));
    return;
  }

  if (command === 'football-data') {
    const args = parseArgs(process.argv.slice(3));
    const adapter = new FootballDataAdapter({
      baseUrl: config.services.footballDataBaseUrl,
      apiToken: config.services.footballDataApiToken,
    });

    if (!adapter.isConfigured()) {
      console.log(
        JSON.stringify(
          {
            configured: false,
            message: 'Set FOOTBALL_DATA_API_TOKEN in your local environment to enable provider ingestion.',
          },
          null,
          2,
        ),
      );
      return;
    }

    const query: FootballDataFixtureQuery = { competition: args.competition ?? 'WC' };
    if (args.season) query.season = Number(args.season);
    if (args.dateFrom) query.dateFrom = args.dateFrom;
    if (args.dateTo) query.dateTo = args.dateTo;
    if (args.status) query.status = args.status as ProviderMatchStatus;
    if (args.matchday) query.matchday = Number(args.matchday);
    const matches = await adapter.listCompetitionMatches(query);
    console.log(
      JSON.stringify(
        {
          configured: true,
          count: matches.length,
          matches: matches.slice(0, Number(args.limit ?? 20)),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'pool') {
    const args = parseArgs(process.argv.slice(3));
    const adapter = new PoolDistributionAdapter(config);
    const matchId = args.match;
    const limit = Number(args.limit ?? 20);

    if (matchId) {
      console.log(JSON.stringify({ pool: await adapter.getMatchPool(matchId) }, null, 2));
      return;
    }

    const pools = await adapter.listMatchPools();
    console.log(
      JSON.stringify(
        {
          count: pools.length,
          pools: pools.slice(0, Number.isFinite(limit) ? Math.max(1, limit) : 20),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'crowd') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('crowd requires --match <id>.');

    const pool = await new PoolDistributionAdapter(config).getMatchPool(matchId);
    const crowding = new CrowdModel().estimateExactScoreCrowding(pool);
    console.log(JSON.stringify({ crowding }, null, 2));
    return;
  }

  if (command === 'ev') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('ev requires --match <id>.');

    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const match = await new BolaoChainClient(config).queryMatch(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const pool = await new PoolDistributionAdapter(config).getMatchPool(matchId);
    const crowding = new CrowdModel().estimateExactScoreCrowding(pool);
    const forecast = new ForecastModel().forecastScoreMatrix(toSmartCupMatch(match));
    const ev = new PayoutEvModel().computeCandidatePayoutEv(forecast, crowding, stakePlanck, fundingSource);
    console.log(JSON.stringify({ payoutEv: { ...ev, candidates: ev.candidates.slice(0, Number(args.limit ?? 20)) } }, null, 2));
    return;
  }

  if (command === 'points') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('points requires --match <id>.');

    const chain = new BolaoChainClient(config);
    const [match, state, profile] = await Promise.all([
      chain.queryMatch(matchId),
      chain.queryState(),
      loadTournamentProfile(config.artifacts.tournamentProfilePath),
    ]);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const smartCupMatch = toSmartCupMatch(match);
    const forecast = new ForecastModel().forecastScoreMatrix(smartCupMatch);
    const reconciledProfile = reconcileTournamentProfileWithChain(profile, state);
    const pointsEv = new PointsEvModel().computeCandidatePointsEv(smartCupMatch, forecast, reconciledProfile);
    console.log(
      JSON.stringify(
        { pointsEv: { ...pointsEv, candidates: pointsEv.candidates.slice(0, Number(args.limit ?? 20)) } },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'leaderboard') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('leaderboard requires --match <id>.');

    const chain = new BolaoChainClient(config);
    const [match, state, profile] = await Promise.all([
      chain.queryMatch(matchId),
      chain.queryState(),
      loadTournamentProfile(config.artifacts.tournamentProfilePath),
    ]);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const smartCupMatch = toSmartCupMatch(match);
    const forecast = new ForecastModel().forecastScoreMatrix(smartCupMatch);
    const reconciledProfile = reconcileTournamentProfileWithChain(profile, state);
    const pointsEv = new PointsEvModel().computeCandidatePointsEv(smartCupMatch, forecast, reconciledProfile);
    const leaderboard = new LeaderboardModel().simulateTopFiveEquity(
      pointsEv,
      state,
      reconciledProfile,
      config.wallet.hexAddress,
    );
    console.log(
      JSON.stringify(
        { leaderboard: { ...leaderboard, candidates: leaderboard.candidates.slice(0, Number(args.limit ?? 20)) } },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'opponents') {
    const args = parseArgs(process.argv.slice(3));
    const report = await new OpponentFeatureAdapter(config).importProfiles({ limit: Number(args.limit ?? 500) });
    console.log(
      JSON.stringify(
        { opponents: { ...report, profiles: report.profiles.slice(0, Number(args.profiles ?? args.limit ?? 25)) } },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'sample-opponents') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('sample-opponents requires --match <id>.');

    const match = await new BolaoChainClient(config).queryMatch(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const smartCupMatch = toSmartCupMatch(match);
    const pool = await new PoolDistributionAdapter(config).getMatchPool(matchId);
    const crowding = new CrowdModel().estimateExactScoreCrowding(pool);
    const forecast = new ForecastModel().forecastScoreMatrix(smartCupMatch);
    const opponents = await new OpponentFeatureAdapter(config).importProfiles({ limit: Number(args.limit ?? 500) });
    const sampled = new OpponentSamplerModel({
      seed: args.seed ?? 'smartcup-agent',
      topScores: Number(args.topScores ?? 8),
    }).sampleOpponentPredictions(
      smartCupMatch,
      forecast,
      crowding,
      opponents.profiles.slice(0, Number(args.profiles ?? 50)),
    );
    console.log(JSON.stringify({ opponentSamples: sampled, sourceWarnings: opponents.warnings }, null, 2));
    return;
  }

  if (command === 'simulate') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('simulate requires --match <id>.');

    const result = await buildSimulationInputs(config, matchId, {
      seed: args.seed ?? 'smartcup-agent',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
    });
    const iterations = Number(args.iterations ?? 2000);
    const objective = parseRiskMode(args.objective ?? 'balanced');
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const simulation = new MonteCarloLeaderboardModel({
      iterations: Number.isFinite(iterations) ? iterations : 2000,
      seed: args.seed ?? 'smartcup-agent',
      candidateLimit: Number(args.candidates ?? 12),
    }).simulateCandidateScores({
      forecast: result.forecast,
      pointsEv: result.pointsEv,
      opponentSamples: result.opponentSamples.samples,
      state: result.state,
      profile: result.profile,
      wallet: config.wallet.hexAddress,
    });
    const opponentAware = new OpponentAwareOutputModel().buildReport(simulation, objective);
    const payoutEv = new PayoutEvModel().computeCandidatePayoutEv(
      result.forecast,
      result.crowding,
      stakePlanck,
      fundingSource,
    );
    const risk = new RiskModeModel().evaluate({
      riskMode: objective,
      fundingSource,
      payoutEv,
      pointsEv: result.pointsEv,
      crowding: result.crowding,
      opponentAware,
    });

    console.log(
      JSON.stringify(
        {
          simulation: {
            objective,
            ...simulation,
            candidates: simulation.candidates.slice(0, Number(args.candidates ?? 12)),
          },
          opponentAware: {
            ...opponentAware,
            outputs: opponentAware.outputs.slice(0, Number(args.candidates ?? 12)),
          },
          risk: {
            ...risk,
            candidates: risk.candidates.slice(0, Number(args.candidates ?? 12)),
          },
          opponents: {
            sources: result.opponents.sources,
            profiles: result.opponents.profiles.slice(0, Number(args.profiles ?? 50)).map((profile) => ({
              wallet: profile.wallet,
              displayName: profile.displayName,
              archetype: profile.archetype,
              archetypeConfidence: profile.archetypeConfidence,
              participationRate: profile.participation.participationRate,
              predictionsObserved: profile.participation.predictionsObserved,
              currentPoints: profile.rankPressure.currentPoints,
              pressureMode: profile.rankPressure.pressureMode,
              sampleQuality: profile.sampleQuality.label,
              topPickedScores: profile.scoreTendencies.topPickedScores.slice(0, 3),
            })),
          },
          opponentSamples: {
            totalOpponents: result.opponentSamples.totalOpponents,
            expectedParticipants: result.opponentSamples.expectedParticipants,
            likelyParticipants: result.opponentSamples.samples
              .filter((sample) => sample.willParticipate)
              .slice(0, 10)
              .map((sample) => ({
                wallet: sample.wallet,
                displayName: sample.displayName,
                archetype: sample.archetype,
                participationProbability: sample.participationProbability,
                selectedScore: sample.selectedScore,
                selectedOutcome: sample.selectedOutcome,
                rankPressureMode: sample.rankPressureMode,
                distributionTop: sample.distributionTop.slice(0, 3),
              })),
          },
          sourceWarnings: result.opponents.warnings,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'decide') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('decide requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 12);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 2000),
      candidateLimit,
    });
    const shouldSave = args.save !== 'false' && args['no-save'] !== 'true';
    if (shouldSave) new MemoryStore().saveDecision(decision);

    if ((args.format ?? 'json') === 'summary') {
      printDecisionSummary(decision);
      if (shouldSave) {
        console.log('');
        console.log(`Saved decision report: ${decision.id}`);
      }
      return;
    }

    console.log(JSON.stringify({ decisionReport: decision }, null, 2));
    return;
  }

  if (command === 'market') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('market requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-market',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            marketComparison: decision.sections.marketComparison,
            selected: decision.selected,
            probabilities: decision.probabilities,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printMarketComparisonSummary(decision);
    return;
  }

  if (command === 'timing') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('timing requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-timing',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            timingStrategy: decision.sections.timingStrategy,
            selected: decision.selected,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printTimingStrategySummary(decision);
    return;
  }

  if (command === 'crowd-map') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('crowd-map requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-crowd-map',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            crowdContrarianMap: decision.sections.crowdContrarianMap,
            selected: decision.selected,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printCrowdContrarianMapSummary(decision);
    return;
  }

  if (command === 'context-risk') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('context-risk requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-context-risk',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            footballContextRisk: decision.sections.footballContextRisk,
            selected: decision.selected,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printFootballContextRiskSummary(decision);
    return;
  }

  if (command === 'position-strategy') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('position-strategy requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-position-strategy',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            tournamentPositionStrategy: decision.sections.tournamentPositionStrategy,
            selected: decision.selected,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printTournamentPositionStrategySummary(decision);
    return;
  }

  if (command === 'alternatives') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('alternatives requires --match <id>.');

    const objective = parseRiskMode(args.risk ?? args.objective ?? 'balanced');
    const candidateLimit = Number(args.candidates ?? 8);
    const fundingSource = parseFundingSource(args.funding ?? args.fundingSource ?? 'cash');
    const stakePlanck = await resolveStakePlanck(config, args);
    const decision = await buildDecisionForMatch(config, matchId, {
      riskMode: objective,
      fundingSource,
      stakePlanck,
      seed: args.seed ?? 'smartcup-agent-alternatives',
      opponentLimit: Number(args.limit ?? 500),
      profileLimit: Number(args.profiles ?? 50),
      topScores: Number(args.topScores ?? 8),
      iterations: Number(args.iterations ?? 1000),
      candidateLimit,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(
        JSON.stringify(
          {
            decisionId: decision.id,
            alternativePickSet: decision.sections.alternativePickSet,
            selected: decision.selected,
            sourceWarnings: decision.sourceWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    printAlternativePickSetSummary(decision);
    return;
  }

  if (command === 'recommend') {
    const args = parseArgs(process.argv.slice(3));
    const matchId = args.match;
    if (!matchId) throw new Error('recommend requires --match <id>.');

    const match = await new BolaoChainClient(config).queryMatch(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const forecast = new ForecastModel().forecastScoreMatrix(toSmartCupMatch(match));
    console.log(
      JSON.stringify(
        {
          forecast: {
            ...forecast,
            rankedScores: forecast.rankedScores.slice(0, 12),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'report') {
    const args = parseArgs(process.argv.slice(3));
    const memory = new MemoryStore();
    const predictions = memory.listPredictions();
    const decisions = memory.listDecisions();
    const transactionPlans = memory.listTransactionPlans();
    const transactionResults = memory.listTransactionResults();
    const outcomeEvaluations = memory.listOutcomeEvaluations();
    const report = buildMemoryReport({
      predictions,
      decisions,
      transactionPlans,
      transactionResults,
      outcomeEvaluations,
    });
    if (args.full === 'true') {
      console.log(
        JSON.stringify(
          {
            ...report,
            raw: {
              predictions,
              decisions,
              transactionPlans,
              transactionResults,
              outcomeEvaluations,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if ((args.format ?? 'summary') === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(renderMemoryReportSummary(report));
    return;
  }

  if (command === 'calibration') {
    const args = parseArgs(process.argv.slice(3));
    const memory = new MemoryStore();
    const report = new PostMatchCalibrationModel().buildReport({
      decisions: memory.listDecisions(),
      evaluations: memory.listOutcomeEvaluations(),
      tournamentId: optionalArg(args, 'tournament') ?? optionalArg(args, 'tournament-id') ?? null,
      matchId: optionalArg(args, 'match') ?? null,
      limit: args.limit ? Number(args.limit) : null,
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(JSON.stringify({ postMatchCalibration: report }, null, 2));
      return;
    }

    console.log(renderPostMatchCalibrationSummary(report));
    return;
  }

  if (command === 'list-reports') {
    const args = parseArgs(process.argv.slice(3));
    const memory = new MemoryStore();
    const lookup = buildPersonalSavedReportLookup({
      decisions: memory.listDecisions(),
      decisionId: optionalArg(args, 'decision'),
      matchId: optionalArg(args, 'match'),
      tournamentId: optionalArg(args, 'tournament') ?? optionalArg(args, 'tournament-id'),
      product: args.product ? parsePersonalSavedReportProduct(args.product) : undefined,
      riskMode: args.risk ? parseRiskMode(args.risk) : undefined,
      dateFrom: optionalArg(args, 'from') ?? optionalArg(args, 'date-from') ?? optionalArg(args, 'since'),
      dateTo: optionalArg(args, 'to') ?? optionalArg(args, 'date-to') ?? optionalArg(args, 'until'),
      limit: Number(args.limit ?? 20),
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(JSON.stringify({ savedReports: lookup }, null, 2));
      return;
    }

    console.log(renderPersonalSavedReportLookupSummary(lookup));
    return;
  }

  if (command === 'export-report') {
    const args = parseArgs(process.argv.slice(3));
    const memory = new MemoryStore();
    const exported = buildPersonalReportExport({
      decisions: memory.listDecisions(),
      format: parseExportFormat(args.format ?? 'markdown'),
      decisionId: optionalArg(args, 'decision'),
      matchId: optionalArg(args, 'match'),
      tournamentId: optionalArg(args, 'tournament') ?? optionalArg(args, 'tournament-id'),
      riskMode: args.risk ? parseRiskMode(args.risk) : undefined,
      limit: Number(args.limit ?? (args.decision || args.match ? 1 : 5)),
    });

    if (args.summary === 'true') {
      console.log(renderPersonalReportExportSummary(exported));
      return;
    }

    console.log(exported.text);
    return;
  }

  if (command === 'freebet') {
    const subcommand = process.argv[3] ?? 'status';
    if (subcommand !== 'status') {
      throw new Error('freebet requires subcommand: status.');
    }
    const args = parseArgs(process.argv.slice(4));
    const wallet = (optionalArg(args, 'wallet') ?? optionalArg(args, 'address') ?? config.wallet.hexAddress) as ActorId;
    const report = await buildFreebetStatusReport(config, { wallet });
    if ((args.format ?? 'json') === 'summary') {
      console.log(renderFreebetStatusSummary(report));
    } else {
      console.log(JSON.stringify({ freebetStatus: report }, null, 2));
    }
    return;
  }

  if (command === 'refund') {
    const subcommand = process.argv[3] ?? 'status';
    if (subcommand !== 'status') {
      throw new Error('refund requires subcommand: status.');
    }
    const args = parseArgs(process.argv.slice(4));
    const wallet = (optionalArg(args, 'wallet') ?? optionalArg(args, 'address') ?? config.wallet.hexAddress) as ActorId;
    const report = await buildRefundStatusReport(config, { wallet });
    if ((args.format ?? 'json') === 'summary') {
      console.log(renderRefundStatusSummary(report));
    } else {
      console.log(JSON.stringify({ refundStatus: report }, null, 2));
    }
    return;
  }

  if (command === 'telegram-config') {
    const args = parseArgs(process.argv.slice(3));
    const permissionModel = new TelegramPermissionModel(config);
    const userId = optionalArg(args, 'user-id');
    const commandToCheck = optionalArg(args, 'command') ?? 'start';
    const decision = userId
      ? permissionModel.canRun(commandToCheck, { id: userId })
      : null;
    const report = {
      mode: config.telegram.mode,
      tokenConfigured: Boolean(config.telegram.botToken),
      webhookConfigured: Boolean(config.telegram.webhookUrl),
      publicBotName: config.telegram.publicBotName,
      adminCount: config.telegram.adminIds.length,
      userCommands,
      adminCommands,
      permissionCheck: decision,
    };
    if ((args.format ?? 'json') === 'summary') {
      console.log(`Telegram mode: ${report.mode}`);
      console.log(`Token configured: ${report.tokenConfigured}`);
      console.log(`Webhook configured: ${report.webhookConfigured}`);
      console.log(`Public bot name: ${report.publicBotName}`);
      console.log(`Admin count: ${report.adminCount}`);
      if (decision) {
        console.log(`Permission: ${decision.allowed ? 'allowed' : 'denied'} (${decision.role})`);
        console.log(`Reason: ${decision.reason}`);
      }
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
    return;
  }

  if (command === 'telegram-nl-smoke') {
    const args = parseArgs(process.argv.slice(3));
    const text = optionalArg(args, 'text');
    const texts = text ? [text] : parseSmokeTexts(optionalArg(args, 'texts'));
    if (texts.length === 0) {
      throw new Error('telegram-nl-smoke requires --text "<message>" or --texts "message one||message two".');
    }
    const userId = optionalArg(args, 'user-id') ?? 'local-smoke-user';
    const chatId = optionalArg(args, 'chat-id') ?? 'local-smoke-chat';
    const saveTelemetry = args.save !== 'false' && args['no-save'] !== 'true';
    const memory = new MemoryStore(optionalArg(args, 'memory-path'), optionalArg(args, 'sqlite-path'));
    const report = await buildTelegramNaturalLanguageSmokeReport(config, {
      texts,
      userId,
      chatId,
      hasWizardSession: args['wizard-session'] === 'true' || args.wizard === 'true',
      saveTelemetry,
      memory,
    });

    if ((args.format ?? 'json') === 'summary') {
      for (const item of report.messages) {
        console.log(`Text hash: ${item.rawTextHash}`);
        console.log(`Route: ${item.route.kind}${item.route.command ? ` /${item.route.command}` : ''}`);
        if (item.parsed) {
          console.log(`Intent: ${item.parsed.intent}`);
          console.log(`Permission: ${item.parsed.permission}`);
          console.log(`Safety: ${item.parsed.safety}`);
          console.log(`Confidence: ${item.parsed.confidence}`);
          console.log(`Action: ${item.actionTaken}`);
          console.log(`Outcome: ${item.safetyOutcome}`);
          console.log(`Missing: ${item.parsed.missingRequiredSlots.join(', ') || 'none'}`);
          console.log(`Ambiguous: ${item.parsed.ambiguousSlots.join(', ') || 'none'}`);
          console.log(`Telemetry saved: ${item.telemetrySaved}`);
        }
        console.log('');
      }
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
    return;
  }

  if (command === 'telegram-private-smoke') {
    const args = parseArgs(process.argv.slice(3));
    const report = await runTelegramPrivateSmokeSuite(config, {
      regularUserId: optionalArg(args, 'user-id') ?? optionalArg(args, 'regular-user-id') ?? '123456',
      adminUserId: optionalArg(args, 'admin-user-id') ?? '999999',
      memoryPath:
        optionalArg(args, 'memory-path') ??
        `${tmpdir()}/smartpredictor-telegram-private-smoke-${Date.now()}.json`,
      sqlitePath:
        optionalArg(args, 'sqlite-path') ??
        `${tmpdir()}/smartpredictor-telegram-private-smoke-${Date.now()}.sqlite`,
      saveTelemetry: args.save !== 'false' && args['no-save'] !== 'true',
    });

    if ((args.format ?? 'summary') === 'json') {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }

    console.log(`Private Telegram smoke: ${report.ok ? 'PASS' : 'FAIL'}`);
    console.log(`Contacted Telegram: ${report.contactedTelegram}`);
    console.log(`Cases: ${report.passed}/${report.caseCount} passed`);
    for (const result of report.results) {
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}`);
      if (!result.ok) {
        console.log(`  Expected: ${result.expected}`);
        console.log(`  Actual: ${result.actual}`);
      }
    }
    if (report.notes.length > 0) {
      console.log('');
      for (const note of report.notes) console.log(`Note: ${note}`);
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === 'telegram-bot') {
    const args = parseArgs(process.argv.slice(3));
    await runTelegramBot(config, {
      dryRun: args['dry-run'] === 'true' || args.dryRun === 'true',
    });
    return;
  }

  if (command === 'submit') {
    const args = parseArgs(process.argv.slice(3));
    const memory = new MemoryStore();
    const plan = args.plan
      ? loadStoredTransactionPlan(memory, args.plan)
      : buildTransactionPlanFromSubmitArgs(config, memory, args);
    await applyDuplicatePredictionGuard(config, plan);
    await applyPlaceBetPayloadGuard(config, plan);
    await applyCutoffBufferGuard(config, plan);
    await applySubmitPodiumPickPayloadGuard(plan);
    await applySubmitPodiumPickTimingGuard(config, plan);
    await applyClaimMatchRewardEligibilityGuard(config, plan);
    await applyClaimFinalPrizeEligibilityGuard(config, plan);
    await applyRefundEligibilityGuard(config, plan);
    await applyFreebetReadinessGuard(config, plan);
    await applyBalanceExposureGuard(config, memory, plan);
    memory.saveTransactionPlan(plan);

    const shouldExecute = args.execute === 'true';
    const explicitApproval = args['confirm-execute'] === 'true' || args.confirm === 'execute';
    const transactionResult = shouldExecute
      ? await executeTransactionPlan(config, plan, { explicitApproval })
      : buildStorageOnlyTransactionResult(plan, config.policy.mode);
    memory.saveTransactionResult(transactionResult);

    let confirmationResult: StoredTransactionResult | null = null;
    if (transactionResult.status === 'submitted') {
      const advisor = new ConfirmationReadbackAdvisor(config);
      const report = await advisor.confirmAfterSubmit(plan);
      confirmationResult = advisor.confirmationResult(plan, transactionResult, report);
      memory.saveTransactionResult(confirmationResult);
    }

    if ((args.format ?? 'json') === 'summary') {
      console.log(`Stored transaction plan: ${plan.id}`);
      console.log(`Decision: ${plan.decisionId ?? 'n/a'}`);
      console.log(`Kind: ${plan.kind}`);
      console.log(`Method: ${plan.method}`);
      console.log(`Args: ${JSON.stringify(plan.args)}`);
      console.log(`Value: ${plan.valuePlanck} planck`);
      console.log(`Status: ${plan.status}`);
      console.log(`Requires approval: ${plan.requiresApproval}`);
      console.log(`Execute requested: ${shouldExecute}`);
      console.log(`Explicit approval: ${explicitApproval}`);
      console.log(`Result: ${transactionResult.status}`);
      console.log(`Reason: ${transactionResult.error ?? 'Transaction submitted or plan stored.'}`);
      if (confirmationResult) {
        console.log(`Confirmation result: ${confirmationResult.status}`);
        console.log(`Confirmation reason: ${confirmationResult.error ?? 'confirmed'}`);
      }
      return;
    }

    console.log(jsonStringify({ transactionPlan: plan, transactionResult, confirmationResult }, 2));
    return;
  }

  if (command === 'claim') {
    const args = parseArgs(process.argv.slice(3));
    const subcommand = process.argv[3] ?? 'pending';
    const wallet = (args.wallet ?? config.wallet.hexAddress) as ActorId;

    if (subcommand === 'status') {
      const report = await buildRefundStatusReport(config, { wallet });
      if ((args.format ?? 'summary') === 'json') console.log(jsonStringify({ claimStatus: report }, 2));
      else console.log(renderRefundStatusSummary(report));
      return;
    }

    if (subcommand === 'pending' || subcommand === 'plan') {
      if (wallet !== config.wallet.hexAddress) {
        throw new Error('claim pending can plan claims only for the configured agent wallet.');
      }

      const memory = new MemoryStore();
      const result = await buildPendingClaimPlans(config, memory);
      if ((args.format ?? 'json') === 'summary') {
        printPendingClaimPlanSummary(result);
        return;
      }
      console.log(jsonStringify(result, 2));
      return;
    }

    throw new Error('claim requires subcommand: status|pending.');
  }

  if (command === 'evaluate') {
    const args = parseArgs(process.argv.slice(3));
    const decisionId = args.decision;
    if (!decisionId) throw new Error('evaluate requires --decision <decision_id>.');

    const memory = new MemoryStore();
    const decision = memory.listDecisions().find((entry) => entry.id === decisionId);
    if (!decision) throw new Error(`Decision report not found: ${decisionId}`);

    const chain = new BolaoChainClient(config);
    const [match, claimStatus] = await Promise.all([
      chain.queryMatch(decision.matchId),
      chain.queryWalletClaimStatus(config.wallet.hexAddress).catch((error: unknown) => error),
    ]);
    if (!match) throw new Error(`Match not found: ${decision.matchId}`);

    const transactionPlans = memory.listTransactionPlans().filter((plan) => plan.decisionId === decision.id);
    const transactionResults = memory
      .listTransactionResults()
      .filter((result) => transactionPlans.some((plan) => plan.id === result.planId));
    const evaluation = buildOutcomeEvaluation(decision, match, claimStatus, transactionResults);
    memory.saveOutcomeEvaluation(evaluation);

    if ((args.format ?? 'json') === 'summary') {
      console.log(`Stored outcome evaluation: ${evaluation.id}`);
      console.log(`Decision: ${evaluation.decisionId}`);
      console.log(`Match: ${evaluation.matchId}`);
      console.log(`Status: ${evaluation.status}`);
      console.log(`Actual result status: ${evaluation.actual.resultStatus}`);
      console.log(`Awarded weighted points: ${evaluation.points.awardedWeightedPoints ?? 'n/a'}`);
      console.log(`Payout status: ${evaluation.payout.status}`);
      console.log(`Error classification: ${evaluation.errorClassification}`);
      for (const note of evaluation.notes) console.log(`- ${note}`);
      return;
    }

    console.log(JSON.stringify({ outcomeEvaluation: evaluation }, null, 2));
    return;
  }

  console.log('');
  console.log('Command implementation is scaffolded. See docs/plans/2026-05-28-smartcup-agent-tasks.md for the next task.');
}

async function buildSimulationInputs(
  config: ReturnType<typeof loadConfig>,
  matchId: string,
  options: {
    seed: string;
    opponentLimit: number;
    profileLimit: number;
    topScores: number;
  },
) {
  const chain = new BolaoChainClient(config);
  const [match, state, profile] = await Promise.all([
    chain.queryMatch(matchId),
    chain.queryState(),
    loadTournamentProfile(config.artifacts.tournamentProfilePath),
  ]);
  if (!match) throw new Error(`Match not found: ${matchId}`);

  const smartCupMatch = toSmartCupMatch(match);
  const reconciledProfile = reconcileTournamentProfileWithChain(profile, state);
  const pool = await new PoolDistributionAdapter(config).getMatchPool(matchId);
  const crowding = new CrowdModel().estimateExactScoreCrowding(pool);
  const forecast = new ForecastModel().forecastScoreMatrix(smartCupMatch);
  const pointsEv = new PointsEvModel().computeCandidatePointsEv(smartCupMatch, forecast, reconciledProfile);
  const opponents = await new OpponentFeatureAdapter(config).importProfiles({ limit: options.opponentLimit });
  const opponentSamples = new OpponentSamplerModel({
    seed: options.seed,
    topScores: options.topScores,
  }).sampleOpponentPredictions(
    smartCupMatch,
    forecast,
    crowding,
    opponents.profiles.slice(0, options.profileLimit),
  );

  return {
    match: smartCupMatch,
    state,
    profile: reconciledProfile,
    pool,
    crowding,
    forecast,
    pointsEv,
    opponents,
    opponentSamples,
  };
}

function buildDecisionReport(params: {
  config: ReturnType<typeof loadConfig>;
  match: SmartCupMatch;
  profile: TournamentProfile;
  forecast: ScoreMatrixForecast;
  pool: MatchPoolDistributionView;
  crowding: ReturnType<CrowdModel['estimateExactScoreCrowding']>;
  payoutEv: CandidatePayoutEvReport;
  pointsEv: CandidatePointsEvReport;
  simulation: MonteCarloLeaderboardSimulationReport;
  opponentAware: OpponentAwareOutputReport;
  risk: RiskModeEvaluationReport;
  fundingSource: FundingSource;
  stakePlanck: string;
  sourceWarnings: string[];
  candidateLimit: number;
  state: IoSmartCupState;
  opponentSamples: OpponentPredictionSamplerReport;
}): DecisionReport {
  const selected = params.risk.selected;
  if (!selected) throw new Error(`No risk-mode candidate selected for match ${params.match.matchId}`);

  const key = scoreKey(selected.score);
  const selectedForecast = params.forecast.rankedScores.find((candidate) => scoreKey(candidate.score) === key);
  const selectedPayout = params.payoutEv.candidates.find((candidate) => scoreKey(candidate.score) === key);
  const selectedPoints = params.pointsEv.candidates.find((candidate) => scoreKey(candidate.score) === key);
  const selectedOpponentAware = params.opponentAware.outputs.find((candidate) => scoreKey(candidate.score) === key);
  const selectedPenaltyWinner = selectPenaltyWinner(selected.outcome, selectedForecast?.penaltyWinnerProbabilities);
  const confidence = confidenceFrom(selected.utility, selectedForecast?.probability ?? selected.components.forecast);
  const confidenceLabel = confidence < 0.45 ? 'low' : confidence < 0.7 ? 'medium' : 'high';
  const varaUsdPrice = varaUsdPriceFromState(params.state);
  const generatedAt = new Date().toISOString();
  const recommendation = `${params.match.home} ${selected.score.home}-${selected.score.away} ${params.match.away}`;
  const headline = `${recommendation} under ${params.risk.riskMode} mode`;
  const topLimit = Number.isFinite(params.candidateLimit) && params.candidateLimit > 0 ? params.candidateLimit : 12;
  const marketComparison = buildUnavailableMarketComparison(params.match.matchId, selected.score, selected.outcome);
  const timingStrategy = buildUnavailableTimingStrategy(params.match, params.profile.cutoff);
  const crowdContrarianMap = buildUnavailableCrowdContrarianMap(params.match.matchId);
  const footballContextRisk = buildUnavailableFootballContextRisk(params.match.matchId);
  const tournamentPositionStrategy = buildUnavailableTournamentPositionStrategy(
    params.match,
    params.config.wallet.hexAddress,
    params.pointsEv.phaseWeight,
  );
  const alternativePickSet = buildUnavailableAlternativePickSet(params.match.matchId);
  const confidenceDegradation = buildUnavailableConfidenceDegradation(params.match.matchId, confidence, confidenceLabel);
  const sourceQuality = buildUnavailableSourceQuality(params.match.matchId);

  return {
    id: `decision-${params.match.matchId}-${params.risk.riskMode}-${selected.score.home}-${selected.score.away}-${Date.parse(generatedAt)}`,
    generatedAt,
    schemaVersion: 'smartpredictor.decision_report.v1',
    modelVersions: {
      forecast: params.forecast.model,
      crowding: params.crowding.model,
      payoutEv: params.payoutEv.model,
      pointsEv: params.pointsEv.model,
      simulation: params.simulation.model,
      opponentAware: params.opponentAware.model,
      risk: params.risk.model,
      marketComparison: marketComparison.model,
      timingStrategy: timingStrategy.model,
      crowdContrarianMap: crowdContrarianMap.model,
      footballContextRisk: footballContextRisk.model,
      tournamentPositionStrategy: tournamentPositionStrategy.model,
      alternativePickSet: alternativePickSet.model,
      confidenceDegradation: confidenceDegradation.model,
      sourceQuality: sourceQuality.model,
    },
    wallet: {
      accountName: params.config.wallet.accountName,
      address: params.config.wallet.hexAddress,
      ss58: params.config.wallet.ss58Address,
    },
    matchId: params.match.matchId,
    match: params.match,
    tournament: {
      id: params.profile.tournamentId,
      name: params.profile.name,
      phase: params.match.phase,
      phaseWeight: params.pointsEv.phaseWeight,
    },
    riskMode: params.risk.riskMode,
    selected: {
      score: selected.score,
      outcome: selected.outcome,
      penaltyWinner: selectedPenaltyWinner,
      utility: selected.utility,
      confidence,
    },
    probabilities: {
      exactScore: selectedForecast?.probability ?? selected.components.forecast,
      home: params.forecast.outcomeProbabilities.home,
      draw: params.forecast.outcomeProbabilities.draw,
      away: params.forecast.outcomeProbabilities.away,
    },
    economics: {
      fundingSource: params.fundingSource,
      roiBasis: selectedPayout?.roiBasis ?? params.payoutEv.roiBasis,
      stakePlanck: params.stakePlanck,
      userCapitalAtRiskPlanck: selectedPayout?.userCapitalAtRiskPlanck ?? params.payoutEv.userCapitalAtRiskPlanck,
      expectedRoi: selectedPayout?.expectedRoi ?? null,
      expectedProfitPlanck: selectedPayout?.expectedProfitPlanck ?? null,
      expectedNetValuePlanck: selectedPayout?.expectedNetValuePlanck ?? null,
      payoutIfExactPlanck: selectedPayout?.payoutIfExactPlanck ?? null,
      expectedWeightedPoints: selectedPoints?.expectedWeightedPoints ?? null,
      topFiveProbability: selectedOpponentAware?.probabilities.top5 ?? null,
      expectedFinalPrizeEquityPlanck: selectedOpponentAware?.finalPrize.expectedEquityPlanck ?? null,
      finalPrizeEquityDeltaPlanck: selectedOpponentAware?.finalPrize.equityDeltaPlanck ?? null,
      varaUsdPrice: varaUsdPrice
        ? {
            source: varaUsdPrice.source,
            priceUsdMicro: varaUsdPrice.priceUsdMicro.toString(),
            updatedAt: varaUsdPrice.updatedAt,
          }
        : null,
    },
    sourceSnapshots: {
      chain: {
        finalPrizeAccumulatedPlanck: params.state.final_prize_accumulated,
        protocolFeeAccumulatedPlanck: params.state.protocol_fee_accumulated,
        userPoints: params.state.user_points,
        phaseCount: params.state.phases.length,
        r32LockTime: params.state.r32_lock_time,
        podiumFinalized: params.state.podium_finalized,
        freebetLedgerProgramId: params.state.freebet_ledger_program_id,
      },
      pool: params.pool,
      tournamentProfile: {
        tournamentId: params.profile.tournamentId,
        name: params.profile.name,
        phaseWeights: params.profile.phases.map((phase) => ({
          key: phase.key,
          name: phase.name,
          pointsWeight: phase.pointsWeight,
          weightSource: phase.weightSource ?? 'unknown',
        })),
        cutoff: params.profile.cutoff,
        scoring: params.profile.scoring,
        rewardSplit: params.profile.rewardSplit,
        finalPrize: params.profile.finalPrize,
      },
      opponentSamples: params.opponentSamples,
      odds: [],
      footballContext: {
        lineups: [],
        availability: [],
        news: [],
      },
    },
    candidates: {
      risk: params.risk.candidates.slice(0, topLimit),
      payoutEv: params.payoutEv.topByExpectedProfit.slice(0, topLimit),
      pointsEv: params.pointsEv.topByExpectedWeightedPoints.slice(0, topLimit),
      opponentAware: params.opponentAware.outputs.slice(0, topLimit),
    },
    sections: {
      forecast: params.forecast,
      pool: params.pool,
      crowding: params.crowding,
      payoutEv: params.payoutEv,
      pointsEv: params.pointsEv,
      simulation: params.simulation,
      opponentAware: params.opponentAware,
      risk: params.risk,
      marketComparison,
      timingStrategy,
      crowdContrarianMap,
      footballContextRisk,
      tournamentPositionStrategy,
      alternativePickSet,
      confidenceDegradation,
      sourceQuality,
    },
    sourceWarnings: params.sourceWarnings,
    summary: {
      headline,
      recommendation,
      confidenceLabel,
      bullets: [
        `Funding ${params.fundingSource}; risk utility ${selected.utility} with ${params.risk.riskMode} weights.`,
        `Exact-score probability ${roundForDisplay(selectedForecast?.probability ?? selected.components.forecast)}; outcome probabilities home/draw/away ${roundForDisplay(params.forecast.outcomeProbabilities.home)}/${roundForDisplay(params.forecast.outcomeProbabilities.draw)}/${roundForDisplay(params.forecast.outcomeProbabilities.away)}.`,
        selectedPayout
          ? formatPayoutEvBullet(selectedPayout.expectedRoi, selectedPayout.expectedNetValuePlanck, varaUsdPrice)
          : 'Payout EV unavailable for selected score.',
        selectedPoints
          ? `Points EV ${roundForDisplay(selectedPoints.expectedWeightedPoints)} weighted points in ${params.match.phase} x${params.pointsEv.phaseWeight}.`
          : 'Points EV unavailable for selected score.',
        selectedOpponentAware
          ? `Opponent-aware top-five probability ${roundForDisplay(selectedOpponentAware.probabilities.top5)} with equity delta ${selectedOpponentAware.finalPrize.equityDeltaPlanck} planck.`
          : 'Opponent-aware simulation unavailable for selected score.',
        `Tournament position: ${tournamentPositionStrategy.recommendation}`,
        `Alternative picks: ${alternativePickSet.summary}`,
        `Confidence quality: ${confidenceDegradation.summary}`,
        `Source quality: ${sourceQuality.summary}`,
      ],
    },
    rationale: selected.rationale,
  };
}

function printDecisionSummary(report: DecisionReport): void {
  console.log(report.summary.headline);
  console.log('');
  console.log(`Recommendation: ${report.summary.recommendation}`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log(`Funding: ${report.economics.fundingSource}`);
  console.log(`Confidence: ${report.summary.confidenceLabel} (${report.selected.confidence})`);
  console.log(`Exact probability: ${roundForDisplay(report.probabilities.exactScore)}`);
  console.log(`Outcome probabilities: home ${roundForDisplay(report.probabilities.home)}, draw ${roundForDisplay(report.probabilities.draw)}, away ${roundForDisplay(report.probabilities.away)}`);
  console.log(`Expected weighted points: ${report.economics.expectedWeightedPoints ?? 'n/a'} in ${report.tournament.phase} x${report.tournament.phaseWeight}`);
  console.log(`Payout view: ${payoutSummaryFromReport(report)}`);
  console.log(`Capital at risk: ${planckToVaraString(report.economics.userCapitalAtRiskPlanck)} VARA`);
  console.log(`Top-five probability: ${report.economics.topFiveProbability ?? 'n/a'}`);
  const market = report.sections?.marketComparison;
  console.log(
    market?.selected.outcomeComparison
      ? `Market comparison: agent ${roundForDisplay(market.selected.outcomeComparison.agentProbability)}, market ${market.selected.outcomeComparison.marketNormalizedProbability ?? 'n/a'}, edge ${market.selected.outcomeComparison.edge ?? 'n/a'}`
      : `Market comparison: ${market?.summary ?? 'not available'}`,
  );
  const timing = report.sections?.timingStrategy;
  console.log(
    timing
      ? `Timing strategy: ${formatTimingRecommendationForCli(timing.recommendation)} (${timing.confidence}); safety close ${timing.agentSafetyCloseAt}`
      : 'Timing strategy: not available',
  );
  const crowdMap = report.sections?.crowdContrarianMap;
  console.log(`Crowd map: ${crowdMap?.summary ?? 'not available'}`);
  const contextRisk = report.sections?.footballContextRisk;
  console.log(`Football context: ${contextRisk?.summary ?? 'not available'}`);
  const positionStrategy = report.sections?.tournamentPositionStrategy;
  console.log(`Tournament position: ${positionStrategy?.recommendation ?? 'not available'}`);
  const alternativePickSet = report.sections?.alternativePickSet;
  console.log(`Alternative picks: ${alternativePickSet?.summary ?? 'not available'}`);
  const confidenceDegradation = report.sections?.confidenceDegradation;
  console.log(`Confidence quality: ${confidenceDegradation?.summary ?? 'not available'}`);
  const sourceQuality = report.sections?.sourceQuality;
  console.log(`Source quality: ${sourceQuality?.summary ?? 'not available'}`);
  console.log('');
  for (const bullet of report.summary.bullets) console.log(`- ${bullet}`);
  if (report.sourceWarnings.length > 0) {
    console.log('');
    console.log('Source warnings:');
    for (const warning of report.sourceWarnings) console.log(`- ${warning}`);
  }
}

function payoutSummaryFromReport(report: DecisionReport): string {
  const humanBullet = report.summary.bullets.find(
    (bullet) => bullet.startsWith('Cash payout EV:') || bullet.startsWith('Payout EV:'),
  );
  if (humanBullet) return humanBullet;
  if (report.economics.expectedRoi === null) return 'unavailable';
  return `${roundForDisplay(report.economics.expectedRoi * 100)}% ROI`;
}

function formatTimingRecommendationForCli(recommendation: TimingStrategyReport['recommendation']): string {
  if (recommendation === 'predict_now') return 'predict now';
  if (recommendation === 'wait') return 'wait and refresh';
  return 'blocked by cutoff';
}

function buildUnavailableMarketComparison(
  matchId: string,
  selectedScore: Score,
  selectedOutcome: PoolOutcome,
): MarketOddsComparisonReport {
  const generatedAt = new Date().toISOString();
  return {
    matchId,
    generatedAt,
    model: 'market_odds_comparison_v1',
    provider: 'manual',
    providerConfigured: false,
    observedAt: null,
    markets: {
      matchWinner: null,
      exactScore: null,
    },
    selected: {
      outcome: selectedOutcome,
      score: selectedScore,
      outcomeComparison: null,
      exactScoreComparison: null,
    },
    summary: 'Market comparison unavailable because no odds provider is configured.',
    warnings: ['Odds provider is not configured; market comparison is unavailable.'],
    snapshots: [],
  };
}

function buildUnavailableTimingStrategy(
  match: SmartCupMatch,
  cutoff: TournamentProfile['cutoff'],
): TimingStrategyReport {
  const nowMs = Date.now();
  const predictionCutoffMs = match.kickOffMs - cutoff.predictionCutoffMinutes * 60_000;
  const agentSafetyCloseMs = predictionCutoffMs - cutoff.safetyBufferMs;
  return {
    matchId: match.matchId,
    generatedAt: new Date(nowMs).toISOString(),
    model: 'timing_strategy_v1',
    recommendation: nowMs >= agentSafetyCloseMs ? 'blocked_by_cutoff' : 'predict_now',
    confidence: 'low',
    currentTime: new Date(nowMs).toISOString(),
    kickoffAt: new Date(match.kickOffMs).toISOString(),
    predictionCutoffAt: new Date(predictionCutoffMs).toISOString(),
    agentSafetyCloseAt: new Date(agentSafetyCloseMs).toISOString(),
    minutesUntilKickoff: roundForDisplay((match.kickOffMs - nowMs) / 60_000),
    minutesUntilPredictionCutoff: roundForDisplay((predictionCutoffMs - nowMs) / 60_000),
    minutesUntilAgentSafetyClose: roundForDisplay((agentSafetyCloseMs - nowMs) / 60_000),
    dataVolatility: 'medium',
    sourceQuality: 'partial',
    rationale: ['Timing strategy unavailable in this legacy CLI path; use `decide` for the shared timing model.'],
    signals: [],
    nextReviewAt: null,
    warnings: ['Timing strategy unavailable in this legacy CLI path.'],
  };
}

function buildUnavailableCrowdContrarianMap(matchId: string): CrowdContrarianMapReport {
  return {
    matchId,
    generatedAt: new Date().toISOString(),
    model: 'crowd_contrarian_map_v1',
    confidence: 0,
    outcomeClusters: [],
    likelyPublicScoreClusters: [],
    differentiatedOpportunities: [],
    selectedScoreOpportunity: null,
    summary: 'Crowd contrarian map unavailable in this legacy CLI path.',
    warnings: ['Crowd contrarian map unavailable in this legacy CLI path.'],
    assumptions: [],
  };
}

function buildUnavailableFootballContextRisk(matchId: string): FootballContextRiskReport {
  return {
    matchId,
    generatedAt: new Date().toISOString(),
    model: 'football_context_risk_v1',
    provider: 'manual-football-context',
    providerConfigured: false,
    overallRisk: 'unknown',
    freshness: 'missing',
    uncertainty: 'high',
    lineups: {
      home: null,
      away: null,
    },
    availability: [],
    suspensions: [],
    news: [],
    signals: [],
    summary: 'Lineup, availability, suspension, and news context is unavailable for this match.',
    warnings: ['Football context provider is not configured.'],
    assumptions: [],
  };
}

function buildUnavailableTournamentPositionStrategy(
  match: SmartCupMatch,
  wallet: ActorId,
  phaseWeight: number,
): TournamentPositionStrategyReport {
  return {
    matchId: match.matchId,
    generatedAt: new Date().toISOString(),
    model: 'tournament_position_strategy_v1',
    wallet,
    rankingSource: 'none',
    currentRank: null,
    currentPoints: 0,
    totalRankedWallets: 0,
    pointsBehindLeader: null,
    pointsBehindNextRank: null,
    pointsAheadNextRank: null,
    pointsBehindTopFive: null,
    pointsAheadSixth: null,
    selectedPosture: 'mid_table',
    recommendedRiskMode: 'balanced',
    recommendedObjective: 'balanced',
    recommendation: 'Tournament-position strategy unavailable in this legacy CLI path; use `decide` for the shared position model.',
    confidence: 'low',
    phase: match.phase,
    phaseWeight,
    signals: [],
    rationale: ['Tournament-position strategy unavailable in this legacy CLI path.'],
    warnings: ['Tournament-position strategy unavailable in this legacy CLI path.'],
  };
}

function buildUnavailableAlternativePickSet(matchId: string): AlternativePickSetReport {
  return {
    matchId,
    generatedAt: new Date().toISOString(),
    model: 'alternative_pick_set_v1',
    picks: [],
    summary: 'Alternative pick set unavailable in this legacy CLI path.',
    warnings: ['Alternative pick set unavailable in this legacy CLI path; use `decide` or `alternatives` for the shared model.'],
    assumptions: [],
  };
}

function buildUnavailableConfidenceDegradation(
  matchId: string,
  confidence: number,
  confidenceLabel: 'low' | 'medium' | 'high',
): ConfidenceDegradationReport {
  return {
    matchId,
    generatedAt: new Date().toISOString(),
    model: 'confidence_degradation_v1',
    originalConfidence: confidence,
    adjustedConfidence: confidence,
    originalLabel: confidenceLabel,
    adjustedLabel: confidenceLabel,
    degradationLevel: 'none',
    coverageScore: 1,
    totalPenalty: 0,
    sourceFactors: [],
    summary: 'Confidence degradation unavailable in this legacy CLI path; confidence is unchanged.',
    suggestedRetryAt: null,
    warnings: [],
    assumptions: ['Use `decide` for the shared confidence degradation model.'],
  };
}

function buildUnavailableSourceQuality(matchId: string): SourceQualityReport {
  return {
    matchId,
    generatedAt: new Date().toISOString(),
    model: 'source_quality_v1',
    score: 100,
    label: 'healthy',
    coverageScore: 1,
    degradedReadWarnings: [],
    suggestedRetryAt: null,
    retryReason: null,
    factors: [],
    summary: 'Source quality unavailable in this legacy CLI path; no degraded reads were scored.',
    assumptions: ['Use `decide` for the shared source-quality model.'],
  };
}

function printMarketComparisonSummary(report: DecisionReport): void {
  const market = report.sections?.marketComparison;
  console.log('Market / odds comparison');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!market) {
    console.log('Market comparison is not available on this DecisionReport.');
    return;
  }

  console.log(`Provider: ${market.provider}${market.providerConfigured ? '' : ' (not configured)'}`);
  console.log(`Observed at: ${market.observedAt ?? 'n/a'}`);
  console.log(`Summary: ${market.summary}`);
  console.log('');

  const selectedOutcome = market.selected.outcomeComparison;
  if (selectedOutcome) {
    console.log('Selected outcome edge:');
    console.log(`Agent probability: ${roundForDisplay(selectedOutcome.agentProbability)}`);
    console.log(`Market implied probability: ${selectedOutcome.marketImpliedProbability ?? 'n/a'}`);
    console.log(`Market normalized probability: ${selectedOutcome.marketNormalizedProbability ?? 'n/a'}`);
    console.log(`Edge: ${selectedOutcome.edge ?? 'n/a'} (${selectedOutcome.edgeDirection})`);
    console.log(`Bookmaker: ${selectedOutcome.bookmaker ?? 'n/a'}`);
    console.log(`Decimal price: ${selectedOutcome.priceDecimal ?? 'n/a'}`);
  } else {
    console.log('Selected outcome edge: unavailable');
  }

  const selectedScore = market.selected.exactScoreComparison;
  if (selectedScore) {
    console.log('');
    console.log('Selected exact-score edge:');
    console.log(`Agent probability: ${roundForDisplay(selectedScore.agentProbability)}`);
    console.log(`Market implied probability: ${selectedScore.marketImpliedProbability ?? 'n/a'}`);
    console.log(`Market normalized probability: ${selectedScore.marketNormalizedProbability ?? 'n/a'}`);
    console.log(`Edge: ${selectedScore.edge ?? 'n/a'} (${selectedScore.edgeDirection})`);
    console.log(`Bookmaker: ${selectedScore.bookmaker ?? 'n/a'}`);
    console.log(`Decimal price: ${selectedScore.priceDecimal ?? 'n/a'}`);
  }

  if (market.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of market.warnings) console.log(`- ${warning}`);
  }
}

function printTimingStrategySummary(report: DecisionReport): void {
  const timing = report.sections?.timingStrategy;
  console.log('Timing strategy');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!timing) {
    console.log('Timing strategy is not available on this DecisionReport.');
    return;
  }

  console.log(`Recommendation: ${formatTimingRecommendationForCli(timing.recommendation)}`);
  console.log(`Confidence: ${timing.confidence}`);
  console.log(`Data volatility: ${timing.dataVolatility}`);
  console.log(`Source quality: ${timing.sourceQuality}`);
  console.log(`Kickoff: ${timing.kickoffAt}`);
  console.log(`Prediction cutoff: ${timing.predictionCutoffAt}`);
  console.log(`Agent safety close: ${timing.agentSafetyCloseAt}`);
  console.log(`Minutes until safety close: ${timing.minutesUntilAgentSafetyClose}`);
  console.log(`Next review: ${timing.nextReviewAt ?? 'n/a'}`);
  console.log('');
  console.log('Rationale:');
  for (const line of timing.rationale) console.log(`- ${line}`);
  if (timing.signals.length > 0) {
    console.log('');
    console.log('Signals:');
    for (const signal of timing.signals) {
      console.log(`- ${signal.label}: ${signal.direction}/${signal.severity} - ${signal.detail}`);
    }
  }
  if (timing.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of timing.warnings) console.log(`- ${warning}`);
  }
}

function printCrowdContrarianMapSummary(report: DecisionReport): void {
  const crowdMap = report.sections?.crowdContrarianMap;
  console.log('Crowd contrarian map');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!crowdMap) {
    console.log('Crowd contrarian map is not available on this DecisionReport.');
    return;
  }

  console.log(`Summary: ${crowdMap.summary}`);
  console.log(`Confidence: ${crowdMap.confidence}`);
  console.log('');
  console.log('Visible outcome crowding:');
  for (const outcome of crowdMap.outcomeClusters) {
    console.log(
      `- ${outcome.label}: bets=${outcome.bets}, betShare=${outcome.shareOfBets}, poolShare=${outcome.shareOfMatchPool}, level=${outcome.crowdLevel}`,
    );
  }
  console.log('');
  console.log('Likely public score clusters:');
  for (const cluster of crowdMap.likelyPublicScoreClusters.slice(0, 6)) {
    console.log(
      `- ${cluster.score.home}-${cluster.score.away} ${cluster.outcome}: crowdShare=${cluster.estimatedShareOfMatchPool}, bets=${cluster.estimatedBets}, level=${cluster.clusterLevel}`,
    );
  }
  console.log('');
  console.log('Differentiated opportunities:');
  for (const opportunity of crowdMap.differentiatedOpportunities.slice(0, 6)) {
    console.log(
      `- ${opportunity.score.home}-${opportunity.score.away} ${opportunity.outcome}: score=${opportunity.differentiationScore}, level=${opportunity.opportunityLevel}, forecast=${opportunity.forecastProbability}, crowdShare=${opportunity.estimatedCrowdShare}`,
    );
  }
  if (crowdMap.selectedScoreOpportunity) {
    const selected = crowdMap.selectedScoreOpportunity;
    console.log('');
    console.log(
      `Selected score map: ${selected.score.home}-${selected.score.away} ${selected.outcome}, differentiation=${selected.differentiationScore}, level=${selected.opportunityLevel}`,
    );
  }
  if (crowdMap.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of crowdMap.warnings) console.log(`- ${warning}`);
  }
}

function printFootballContextRiskSummary(report: DecisionReport): void {
  const context = report.sections?.footballContextRisk;
  console.log('Football context risk');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!context) {
    console.log('Football context risk is not available on this DecisionReport.');
    return;
  }

  console.log(`Provider: ${context.provider}${context.providerConfigured ? '' : ' (not configured)'}`);
  console.log(`Overall risk: ${context.overallRisk}`);
  console.log(`Freshness: ${context.freshness}`);
  console.log(`Uncertainty: ${context.uncertainty}`);
  console.log(`Summary: ${context.summary}`);
  console.log('');
  console.log(`Lineups: home=${context.lineups.home?.status ?? 'missing'}, away=${context.lineups.away?.status ?? 'missing'}`);
  console.log(`Availability records: ${context.availability.length}`);
  console.log(`Suspensions: ${context.suspensions.length}`);
  console.log(`News items: ${context.news.length}`);
  if (context.signals.length > 0) {
    console.log('');
    console.log('Signals:');
    for (const signal of context.signals) {
      console.log(`- ${signal.label}: risk=${signal.riskLevel}, freshness=${signal.freshness}, uncertainty=${signal.uncertainty} - ${signal.detail}`);
    }
  }
  if (context.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of context.warnings) console.log(`- ${warning}`);
  }
}

function printTournamentPositionStrategySummary(report: DecisionReport): void {
  const position = report.sections?.tournamentPositionStrategy;
  console.log('Tournament-position strategy');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!position) {
    console.log('Tournament-position strategy is not available on this DecisionReport.');
    return;
  }

  console.log(`Posture: ${position.selectedPosture}`);
  console.log(`Recommendation: ${position.recommendation}`);
  console.log(`Confidence: ${position.confidence}`);
  console.log(`Recommended risk mode: ${position.recommendedRiskMode}`);
  console.log(`Recommended objective: ${position.recommendedObjective}`);
  console.log(`Rank: ${position.currentRank === null ? 'not ranked' : `#${position.currentRank}`} of ${position.totalRankedWallets}`);
  console.log(`Points: ${position.currentPoints}`);
  console.log(`Behind leader: ${position.pointsBehindLeader ?? 'n/a'}`);
  console.log(`Behind next rank: ${position.pointsBehindNextRank ?? 'n/a'}`);
  console.log(`Ahead of next rank: ${position.pointsAheadNextRank ?? 'n/a'}`);
  console.log(`Behind top five: ${position.pointsBehindTopFive ?? 'n/a'}`);
  console.log(`Ahead of sixth: ${position.pointsAheadSixth ?? 'n/a'}`);
  console.log(`Phase: ${position.phase} x${position.phaseWeight}`);
  if (position.signals.length > 0) {
    console.log('');
    console.log('Signals:');
    for (const signal of position.signals) {
      console.log(`- ${signal.label}: posture=${signal.posture}, severity=${signal.severity} - ${signal.detail}`);
    }
  }
  if (position.rationale.length > 0) {
    console.log('');
    console.log('Rationale:');
    for (const line of position.rationale) console.log(`- ${line}`);
  }
  if (position.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of position.warnings) console.log(`- ${warning}`);
  }
}

function printAlternativePickSetSummary(report: DecisionReport): void {
  const alternatives = report.sections?.alternativePickSet;
  console.log('Alternative pick set');
  console.log(`Match: ${report.matchId} ${report.match.home} vs ${report.match.away}`);
  console.log(`Selected prediction: ${report.selected.score.home}-${report.selected.score.away} (${report.selected.outcome})`);
  console.log(`Risk mode: ${report.riskMode}`);
  console.log('');

  if (!alternatives) {
    console.log('Alternative pick set is not available on this DecisionReport.');
    return;
  }

  console.log(`Summary: ${alternatives.summary}`);
  console.log('');
  for (const pick of alternatives.picks) {
    console.log(`${pick.label}: ${pick.score.home}-${pick.score.away} ${pick.outcome}`);
    console.log(`  confidence=${pick.confidence}; utility=${pick.utility}; exact=${pick.exactScoreProbability}; points=${pick.expectedWeightedPoints ?? 'n/a'}; roi=${pick.expectedRoi ?? 'n/a'}; top5=${pick.topFiveProbability ?? 'n/a'}; equityDelta=${pick.finalPrizeEquityDeltaPlanck ?? 'n/a'}`);
    for (const line of pick.rationale.slice(0, 2)) console.log(`  - ${line}`);
  }
  if (alternatives.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of alternatives.warnings) console.log(`- ${warning}`);
  }
}

function buildTransactionPlanFromSubmitArgs(
  config: ReturnType<typeof loadConfig>,
  memory: MemoryStore,
  args: Record<string, string>,
): StoredTransactionPlan {
  const kind = parseTransactionKind(args.kind ?? (args.decision ? 'PlaceBet' : ''));

  if (kind === 'PlaceBet' || kind === 'SpendFreebet') {
    const decisionId = args.decision;
    if (!decisionId) throw new Error(`submit ${kind} requires --decision <decision_id>.`);
    const decision = memory.listDecisions().find((entry) => entry.id === decisionId);
    if (!decision) throw new Error(`Decision report not found: ${decisionId}`);
    const manualScore = parseOptionalManualScore(args);
    const manualPenaltyWinner = parseOptionalPenaltyWinner(args);
    const fundingKind = decision.economics.fundingSource === 'freebet' ? 'SpendFreebet' : 'PlaceBet';
    const effectiveKind = kind === 'PlaceBet' && decision.economics.fundingSource === 'freebet' ? fundingKind : kind;
    if (effectiveKind === 'SpendFreebet') {
      return buildSpendFreebetTransactionPlan(config, {
        decision,
        scoreOverride: manualScore,
        penaltyWinnerOverride: manualPenaltyWinner,
        amountPlanckOverride: args.valuePlanck ?? args['value-planck'] ?? null,
      });
    }
    return buildPlaceBetTransactionPlan(config, {
      decision,
      scoreOverride: manualScore,
      penaltyWinnerOverride: manualPenaltyWinner,
      valuePlanckOverride: args.valuePlanck ?? args['value-planck'] ?? null,
    });
  }

  if (kind === 'SubmitPodiumPick') {
    return buildSubmitPodiumPickTransactionPlan(config, {
      champion: requiredArg(args, 'champion'),
      runnerUp: args.runnerUp ?? requiredArg(args, 'runner-up'),
      thirdPlace: args.thirdPlace ?? requiredArg(args, 'third-place'),
      valuePlanck: args.valuePlanck ?? requiredArg(args, 'value-planck'),
      decisionId: args.decision ?? null,
      riskMode: args.risk ? parseRiskMode(args.risk) : null,
    });
  }

  if (kind === 'ClaimMatchReward') {
    return buildClaimMatchRewardTransactionPlan(config, {
      matchId: parsePositiveInteger(requiredArg(args, 'match')),
    });
  }

  if (kind === 'ClaimRefund') {
    return buildClaimRefundTransactionPlan(config, {
      decisionId: args.decision ?? null,
    });
  }

  return buildClaimFinalPrizeTransactionPlan(config, {
    decisionId: args.decision ?? null,
  });
}

function loadStoredTransactionPlan(memory: MemoryStore, planId: string): StoredTransactionPlan {
  const plan = memory.listTransactionPlans().find((entry) => entry.id === planId);
  if (!plan) throw new Error(`Transaction plan not found: ${planId}`);
  return {
    ...plan,
    safetyChecks: plan.safetyChecks.map((check) =>
      check.name === 'claim_eligibility'
        ? {
            ...check,
            status: 'not_evaluated',
            message: 'Claim eligibility will be refreshed before live execution.',
          }
        : check,
    ),
  };
}

type PendingClaimPlanResult = {
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

async function buildPendingClaimPlans(
  config: ReturnType<typeof loadConfig>,
  memory: MemoryStore,
): Promise<PendingClaimPlanResult> {
  const chain = new BolaoChainClient(config);
  const warnings: string[] = [];
  const skipped: PendingClaimPlanResult['skipped'] = [];
  const plans: StoredTransactionPlan[] = [];
  // Keep these reads sequential. Each query invokes vara-wallet, and parallel
  // subprocesses can exceed small hosted worker memory limits.
  const stateResult = await captureClaimRead(() => chain.queryState());
  const betsResult = await captureClaimRead(() => chain.queryBetsByUser(config.wallet.hexAddress));
  const finalPrizeResult = await captureClaimRead(() => chain.queryFinalPrizeClaimStatus(config.wallet.hexAddress));
  const refundResult = await captureClaimRead(() => chain.queryPendingRefund(config.wallet.hexAddress));

  if (!stateResult.ok) warnings.push(`BolaoCore state read failed: ${stateResult.error}`);
  if (!betsResult.ok) warnings.push(`BolaoCore user bet read failed: ${betsResult.error}`);
  if (!finalPrizeResult.ok) warnings.push(`Final prize claim status read failed: ${finalPrizeResult.error}`);
  if (!refundResult.ok) warnings.push(`Refund recovery read failed: ${refundResult.error}`);

  const matchesById = new Map((stateResult.ok ? stateResult.value.matches : []).map((match) => [String(match.match_id), match]));
  const bets = betsResult.ok ? betsResult.value : [];

  for (const bet of bets) {
    const matchId = String(bet.match_id);
    const match = matchesById.get(matchId);
    if (!match) {
      skipped.push({ kind: 'ClaimMatchReward', matchId, reason: 'Match state was not available.' });
      continue;
    }
    if (bet.claimed) {
      skipped.push({ kind: 'ClaimMatchReward', matchId, reason: 'Match reward already claimed.' });
      continue;
    }
    if (match.result.kind !== 'Finalized') {
      skipped.push({ kind: 'ClaimMatchReward', matchId, reason: 'Match is not finalized yet.' });
      continue;
    }
    if (!isExactWinningBet(bet, match.result.value)) {
      skipped.push({ kind: 'ClaimMatchReward', matchId, reason: 'Stored prediction is not an exact winning result.' });
      continue;
    }

    const plan = buildClaimMatchRewardTransactionPlan(config, { matchId: Number(matchId) });
    await applyClaimMatchRewardEligibilityGuard(config, plan);
    memory.saveTransactionPlan(plan);
    plans.push(plan);
  }

  if (finalPrizeResult.ok) {
    const finalPrize = finalPrizeResult.value;
    if (
      finalPrize.final_prize_finalized &&
      finalPrize.eligible &&
      !finalPrize.already_claimed &&
      BigInt(finalPrize.amount_claimable) > 0n
    ) {
      const plan = buildClaimFinalPrizeTransactionPlan(config);
      await applyClaimFinalPrizeEligibilityGuard(config, plan);
      memory.saveTransactionPlan(plan);
      plans.push(plan);
    } else {
      skipped.push({
        kind: 'ClaimFinalPrize',
        reason: finalPrize.already_claimed
          ? 'Final prize already claimed.'
          : !finalPrize.final_prize_finalized
            ? 'Final prize is not finalized yet.'
            : !finalPrize.eligible
              ? 'Wallet is not eligible for the final prize.'
              : 'Final prize claimable amount is zero.',
      });
    }
  }

  if (refundResult.ok) {
    if (BigInt(refundResult.value) > 0n) {
      const plan = buildClaimRefundTransactionPlan(config);
      await applyRefundEligibilityGuard(config, plan);
      memory.saveTransactionPlan(plan);
      plans.push(plan);
    } else {
      skipped.push({ kind: 'ClaimRefund', reason: 'No refund recovery amount is pending.' });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    wallet: config.wallet.hexAddress,
    plans,
    skipped,
    warnings,
  };
}

function printPendingClaimPlanSummary(result: PendingClaimPlanResult): void {
  console.log(`Wallet: ${result.wallet}`);
  console.log(`Claim plans ready: ${result.plans.length}`);
  for (const plan of result.plans) {
    const matchId = plan.kind === 'ClaimMatchReward' ? ` match=${String(plan.args[0])}` : '';
    console.log(`- ${plan.kind}${matchId}: ${plan.id} status=${plan.status}`);
  }
  console.log(`Skipped: ${result.skipped.length}`);
  for (const skipped of result.skipped.slice(0, 10)) {
    const matchId = skipped.matchId ? ` match=${skipped.matchId}` : '';
    console.log(`- ${skipped.kind}${matchId}: ${skipped.reason}`);
  }
  console.log(result.warnings.length ? `Warnings: ${result.warnings.join(' | ')}` : 'Warnings: none');
}

async function captureClaimRead<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isExactWinningBet(
  bet: { score: Score; penalty_winner: PenaltyWinner | null },
  finalized: { score: Score; penalty_winner: PenaltyWinner | null },
): boolean {
  return (
    bet.score.home === finalized.score.home &&
    bet.score.away === finalized.score.away &&
    bet.penalty_winner === finalized.penalty_winner
  );
}

function buildStorageOnlyTransactionResult(
  plan: StoredTransactionPlan,
  mode: string,
): StoredTransactionResult {
  const createdAt = new Date().toISOString();
  const blocked = plan.status === 'blocked';
  const failedChecks = plan.safetyChecks.filter((check) => check.status === 'fail').map((check) => check.name);
  return {
    id: `txresult-${plan.id}-${blocked ? 'blocked' : 'stored'}`,
    planId: plan.id,
    createdAt,
    updatedAt: createdAt,
    status: blocked ? 'submission_blocked' : 'not_submitted',
    txHash: null,
    messageId: null,
    blockHash: null,
    blockNumber: null,
    error: blocked
      ? `No transaction submitted. Current policy mode is ${mode}; safety gate blocked this ${plan.kind} plan (${failedChecks.join(', ') || 'unknown'}).`
      : `No transaction submitted. Current policy mode is ${mode}; execution path remains disabled until later Phase 6 guards are complete.`,
    chainReadback: null,
    payload: {
      planStatus: plan.status,
      requiresApproval: plan.requiresApproval,
      safetyChecks: plan.safetyChecks,
    },
  };
}

async function resolveStakePlanck(
  config: ReturnType<typeof loadConfig>,
  args: Record<string, string>,
): Promise<string> {
  const stakeUsd = args.stakeUsd ?? args['stake-usd'];
  if (stakeUsd) return (await usdToPlanck(config, stakeUsd)).planck;
  return args.stakePlanck ?? args.stake ?? '4500000000000000';
}

async function applyDuplicatePredictionGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'PlaceBet' && plan.kind !== 'SpendFreebet') return;
  if (plan.status === 'blocked') return;

  const matchId = String(plan.args[0] ?? '');
  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'duplicate_prediction');
  if (checkIndex < 0) return;

  try {
    const chain = new BolaoChainClient(config);
    const userBets = await chain.queryBetsByUser(config.wallet.hexAddress);
    const chainDuplicate = userBets.find((bet) => String(bet.match_id) === matchId);
    let indexerBets: Awaited<ReturnType<IndexerAdapter['listBets']>> = [];
    let indexerWarning: string | null = null;
    try {
      indexerBets = await new IndexerAdapter(
        config.services.indexerGraphqlUrl,
        config.services.indexerGraphqlTimeoutMs,
      ).listBets({
        user: config.wallet.hexAddress,
        matchId,
        first: 5,
      });
    } catch (indexerError) {
      indexerWarning = indexerError instanceof Error ? indexerError.message : String(indexerError);
    }
    const indexerDuplicate = indexerBets[0] ?? null;
    const duplicate = chainDuplicate ?? indexerDuplicate;

    if (duplicate) {
      plan.safetyChecks[checkIndex] = {
        name: 'duplicate_prediction',
        status: 'fail',
        message: `Wallet already has a prediction for match ${matchId}; duplicate ${plan.kind} is blocked.`,
        details: {
          matchId,
          source: chainDuplicate ? 'bolao_query_bets_by_user' : 'indexer',
          existingScore: chainDuplicate
            ? chainDuplicate.score
            : { home: indexerDuplicate?.scoreHome, away: indexerDuplicate?.scoreAway },
          existingPenaltyWinner: chainDuplicate
            ? chainDuplicate.penalty_winner
            : indexerDuplicate?.penaltyWinner ?? null,
          existingStakeInMatchPool: chainDuplicate
            ? chainDuplicate.stake_in_match_pool
            : indexerDuplicate?.stakeRaw,
          claimed: chainDuplicate ? chainDuplicate.claimed : null,
        },
      };
      plan.status = 'blocked';
      plan.requiresApproval = true;
      plan.updatedAt = new Date().toISOString();
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'duplicate_prediction',
      status: 'pass',
      message: `No existing prediction found for wallet ${config.wallet.hexAddress} on match ${matchId}.`,
      details: {
        matchId,
        checkedChainBetCount: userBets.length,
        checkedIndexerBetCount: indexerBets.length,
        indexerWarning,
        note: indexerWarning
          ? 'On-chain duplicate read passed; indexer corroboration was unavailable and treated as a warning.'
          : null,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    plan.safetyChecks[checkIndex] = {
      name: 'duplicate_prediction',
      status: 'fail',
      message: `Duplicate prediction query failed; blocking ${plan.kind} because duplicate safety could not be proven.`,
      details: {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      },
    };
    plan.status = 'blocked';
    plan.requiresApproval = true;
    plan.updatedAt = new Date().toISOString();
  }
}

async function applyPlaceBetPayloadGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'PlaceBet' && plan.kind !== 'SpendFreebet') return;
  if (plan.status === 'blocked') return;

  const matchId = String(plan.args[0] ?? '');
  const score = plan.args[1] as Score | undefined;
  const penaltyWinner = (plan.args[2] ?? null) as PenaltyWinner | null;
  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'place_bet_payload');
  if (checkIndex < 0) return;

  if (!score || typeof score.home !== 'number' || typeof score.away !== 'number') {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'place_bet_payload',
      status: 'fail',
      message: `${plan.kind} payload is missing a valid score object.`,
      details: { matchId, score },
    });
    return;
  }

  try {
    const match = await new BolaoChainClient(config).queryMatch(matchId);
    if (!match) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'place_bet_payload',
        status: 'fail',
        message: `Match ${matchId} was not found; ${plan.kind} payload phase safety could not be proven.`,
        details: { matchId },
      });
      return;
    }

    const evaluation = evaluatePlaceBetPayload({
      matchId,
      phase: match.phase,
      score,
      penaltyWinner,
    });

    if (evaluation.blocked) {
      blockPlanWithSafetyCheck(plan, checkIndex, evaluation.check);
      return;
    }

    plan.safetyChecks[checkIndex] = evaluation.check;
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'place_bet_payload',
      status: 'fail',
      message: `${plan.kind} payload phase readback failed; blocking because penalty-winner safety could not be proven.`,
      details: {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyCutoffBufferGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'PlaceBet' && plan.kind !== 'SpendFreebet') return;
  if (plan.status === 'blocked') return;

  const matchId = String(plan.args[0] ?? '');
  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'cutoff_buffer');
  if (checkIndex < 0) return;

  try {
    const [match, profile] = await Promise.all([
      new BolaoChainClient(config).queryMatch(matchId),
      loadTournamentProfile(config.artifacts.tournamentProfilePath).catch(() => null),
    ]);

    if (!match) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'cutoff_buffer',
        status: 'fail',
        message: `Match ${matchId} was not found; cutoff safety could not be proven.`,
        details: { matchId },
      });
      return;
    }

    const predictionCutoffMinutes = profile?.cutoff.predictionCutoffMinutes ?? 10;
    const safetyBufferMs = profile?.cutoff.safetyBufferMs ?? config.policy.cutoffBufferMs;
    const nowMs = Date.now();

    const evaluation = evaluateCutoffBuffer({
      matchId,
      kickOff: match.kick_off,
      predictionCutoffMinutes,
      safetyBufferMs,
      nowMs,
    });

    if (evaluation.blocked) {
      blockPlanWithSafetyCheck(plan, checkIndex, evaluation.check);
      return;
    }

    plan.safetyChecks[checkIndex] = evaluation.check;
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'cutoff_buffer',
      status: 'fail',
      message: `Cutoff buffer query failed; blocking ${plan.kind} because timing safety could not be proven.`,
      details: {
        matchId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyFreebetReadinessGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'SpendFreebet') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'freebet_readiness');
  if (checkIndex < 0) return;

  try {
    const ledgerConfig = {
      ...config,
      programs: {
        ...config.programs,
        freebetLedger: plan.programId,
      },
    };
    const client = new FreebetLedgerClient(ledgerConfig);
    const amountPlanck = String(plan.args[2] ?? '0');
    const [authorized, balance] = await Promise.all([
      client.isBetProgramAuthorized(config.programs.bolaoCore),
      client.balanceOf(config.wallet.hexAddress),
    ]);

    if (!authorized) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'freebet_readiness',
        status: 'fail',
        message: 'Freebet Ledger does not authorize the configured BolaoCore program.',
        details: {
          freebetLedgerProgramId: plan.programId,
          bolaoCoreProgramId: config.programs.bolaoCore,
        },
      });
      return;
    }

    if (BigInt(balance) < BigInt(amountPlanck)) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'freebet_readiness',
        status: 'fail',
        message: 'Freebet balance is lower than the planned SpendFreebet amount.',
        details: {
          freebetLedgerProgramId: plan.programId,
          freebetBalancePlanck: balance,
          amountPlanck,
        },
      });
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'freebet_readiness',
      status: 'pass',
      message: 'Freebet Ledger authorizes BolaoCore and the wallet balance covers the planned freebet amount.',
      details: {
        freebetLedgerProgramId: plan.programId,
        bolaoCoreProgramId: config.programs.bolaoCore,
        freebetBalancePlanck: balance,
        amountPlanck,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'freebet_readiness',
      status: 'fail',
      message: 'Freebet readiness query failed; blocking SpendFreebet because authorization/balance safety could not be proven.',
      details: {
        freebetLedgerProgramId: plan.programId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyRefundEligibilityGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'ClaimRefund') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'claim_eligibility');
  if (checkIndex < 0) return;

  try {
    const pendingRefundPlanck = await new BolaoChainClient(config).queryPendingRefund(config.wallet.hexAddress);
    if (BigInt(pendingRefundPlanck) <= 0n) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: 'No pending refund is currently claimable for this wallet.',
        details: {
          wallet: config.wallet.hexAddress,
          pendingRefundPlanck,
        },
      });
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'claim_eligibility',
      status: 'pass',
      message: 'Pending refund is claimable for this wallet according to BolaoCore QueryPendingRefund.',
      details: {
        wallet: config.wallet.hexAddress,
        pendingRefundPlanck,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'claim_eligibility',
      status: 'fail',
      message: 'Pending refund readback failed; blocking ClaimRefund because eligibility could not be proven.',
      details: {
        wallet: config.wallet.hexAddress,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applySubmitPodiumPickPayloadGuard(plan: StoredTransactionPlan): Promise<void> {
  if (plan.kind !== 'SubmitPodiumPick') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'podium_pick_payload');
  if (checkIndex < 0) return;
  const [champion, runnerUp, thirdPlace] = plan.args;
  const teams = [champion, runnerUp, thirdPlace].map((value) => (typeof value === 'string' ? value.trim() : ''));
  const [championTeam, runnerUpTeam, thirdPlaceTeam] = teams;
  const uniqueTeams = new Set(teams.map((team) => team.toLowerCase()));

  if (!championTeam || !runnerUpTeam || !thirdPlaceTeam || uniqueTeams.size !== 3) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'podium_pick_payload',
      status: 'fail',
      message: 'SubmitPodiumPick requires three distinct non-empty teams.',
      details: {
        champion,
        runnerUp,
        thirdPlace,
      },
    });
    return;
  }

  plan.safetyChecks[checkIndex] = {
    name: 'podium_pick_payload',
    status: 'pass',
    message: 'SubmitPodiumPick payload has three distinct non-empty teams.',
    details: {
      champion: championTeam,
      runnerUp: runnerUpTeam,
      thirdPlace: thirdPlaceTeam,
    },
  };
  plan.updatedAt = new Date().toISOString();
}

async function applySubmitPodiumPickTimingGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'SubmitPodiumPick') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'podium_timing');
  if (checkIndex < 0) return;

  try {
    const profile = await loadTournamentProfile(config.artifacts.tournamentProfilePath);
    const state = await new BolaoChainClient(config).queryState();
    const reconciled = reconcileTournamentProfileWithChain(profile, state);
    const podiumPick = reconciled.podiumPick;

    if (!podiumPick?.enabled) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'podium_timing',
        status: 'fail',
        message: 'Podium picks are not enabled for the active tournament profile.',
        details: {
          tournamentId: reconciled.tournamentId,
          hasPodiumPickProfile: Boolean(podiumPick),
        },
      });
      return;
    }

    if (state.podium_finalized) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'podium_timing',
        status: 'fail',
        message: 'BolaoCore reports podium picks are finalized; SubmitPodiumPick is blocked.',
        details: {
          tournamentId: reconciled.tournamentId,
          podiumFinalized: state.podium_finalized,
        },
      });
      return;
    }

    const nowMs = Date.now();
    const expectedMs = podiumPick.expectedMatchupDefinedAt ? Date.parse(podiumPick.expectedMatchupDefinedAt) : NaN;
    const kickoffMs = podiumPick.kickoffAt ? Date.parse(podiumPick.kickoffAt) : NaN;
    const cutoffMs = Number.isFinite(kickoffMs)
      ? kickoffMs - reconciled.cutoff.predictionCutoffMinutes * 60_000 - reconciled.cutoff.safetyBufferMs
      : NaN;

    if (!Number.isFinite(expectedMs) || !Number.isFinite(cutoffMs)) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'podium_timing',
        status: 'fail',
        message: 'Podium pick timing could not be proven from tournament profile/live state.',
        details: {
          expectedMatchupDefinedAt: podiumPick.expectedMatchupDefinedAt,
          kickoffAt: podiumPick.kickoffAt,
          lockSource: podiumPick.lockSource ?? null,
        },
      });
      return;
    }

    if (nowMs < expectedMs) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'podium_timing',
        status: 'fail',
        message: 'Podium pick window is not open yet; wait until the matchup clarity time.',
        details: {
          now: new Date(nowMs).toISOString(),
          expectedMatchupDefinedAt: new Date(expectedMs).toISOString(),
          kickoffAt: podiumPick.kickoffAt,
          lockSource: podiumPick.lockSource ?? null,
        },
      });
      return;
    }

    if (nowMs >= cutoffMs) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'podium_timing',
        status: 'fail',
        message: 'Podium pick window is closed or inside the configured safety buffer.',
        details: {
          now: new Date(nowMs).toISOString(),
          safetyCloseAt: new Date(cutoffMs).toISOString(),
          kickoffAt: podiumPick.kickoffAt,
          predictionCutoffMinutes: reconciled.cutoff.predictionCutoffMinutes,
          safetyBufferMs: reconciled.cutoff.safetyBufferMs,
          lockSource: podiumPick.lockSource ?? null,
        },
      });
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'podium_timing',
      status: 'pass',
      message: 'Podium pick window is open and outside the configured safety buffer.',
      details: {
        tournamentId: reconciled.tournamentId,
        now: new Date(nowMs).toISOString(),
        expectedMatchupDefinedAt: new Date(expectedMs).toISOString(),
        safetyCloseAt: new Date(cutoffMs).toISOString(),
        kickoffAt: podiumPick.kickoffAt,
        lockSource: podiumPick.lockSource ?? null,
        podiumFinalized: state.podium_finalized,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'podium_timing',
      status: 'fail',
      message: 'Podium timing readback failed; blocking SubmitPodiumPick because timing safety could not be proven.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyClaimMatchRewardEligibilityGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'ClaimMatchReward') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'claim_eligibility');
  if (checkIndex < 0) return;
  const matchId = String(plan.args[0] ?? '');

  try {
    const chain = new BolaoChainClient(config);
    const [match, bets] = await Promise.all([
      chain.queryMatch(matchId),
      chain.queryBetsByUser(config.wallet.hexAddress),
    ]);
    const bet = bets.find((entry) => String(entry.match_id) === matchId);

    if (!match) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: `Match ${matchId} was not found; match reward claim is blocked.`,
        details: { matchId },
      });
      return;
    }
    if (!bet) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: `Wallet has no stored bet for match ${matchId}; match reward claim is blocked.`,
        details: { matchId, wallet: config.wallet.hexAddress },
      });
      return;
    }
    if (bet.claimed) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: `Match ${matchId} reward is already claimed.`,
        details: { matchId, wallet: config.wallet.hexAddress },
      });
      return;
    }
    if (match.result.kind !== 'Finalized') {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: `Match ${matchId} is not finalized; match reward claim is blocked.`,
        details: { matchId, resultKind: match.result.kind },
      });
      return;
    }
    if (!isExactWinningBet(bet, match.result.value)) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: `Wallet prediction for match ${matchId} is not an exact winning result; match reward claim is blocked.`,
        details: {
          matchId,
          predictedScore: bet.score,
          predictedPenaltyWinner: bet.penalty_winner,
          finalizedScore: match.result.value.score,
          finalizedPenaltyWinner: match.result.value.penalty_winner,
        },
      });
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'claim_eligibility',
      status: 'pass',
      message: `Match ${matchId} has an unclaimed exact winning prediction for this wallet.`,
      details: {
        matchId,
        wallet: config.wallet.hexAddress,
        finalizedScore: match.result.value.score,
        finalizedPenaltyWinner: match.result.value.penalty_winner,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'claim_eligibility',
      status: 'fail',
      message: 'Match reward claim readback failed; blocking claim because eligibility could not be proven.',
      details: {
        matchId,
        wallet: config.wallet.hexAddress,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyClaimFinalPrizeEligibilityGuard(
  config: ReturnType<typeof loadConfig>,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'ClaimFinalPrize') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'claim_eligibility');
  if (checkIndex < 0) return;

  try {
    const status = await new BolaoChainClient(config).queryFinalPrizeClaimStatus(config.wallet.hexAddress);
    if (!status.final_prize_finalized || !status.eligible || status.already_claimed || BigInt(status.amount_claimable) <= 0n) {
      blockPlanWithSafetyCheck(plan, checkIndex, {
        name: 'claim_eligibility',
        status: 'fail',
        message: 'Final prize is not currently claimable for this wallet.',
        details: {
          wallet: config.wallet.hexAddress,
          finalPrizeFinalized: status.final_prize_finalized,
          eligible: status.eligible,
          alreadyClaimed: status.already_claimed,
          amountClaimablePlanck: status.amount_claimable,
          points: status.points,
        },
      });
      return;
    }

    plan.safetyChecks[checkIndex] = {
      name: 'claim_eligibility',
      status: 'pass',
      message: 'Final prize is finalized, eligible, unclaimed, and has a positive claimable amount.',
      details: {
        wallet: config.wallet.hexAddress,
        amountClaimablePlanck: status.amount_claimable,
        points: status.points,
      },
    };
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'claim_eligibility',
      status: 'fail',
      message: 'Final prize claim readback failed; blocking claim because eligibility could not be proven.',
      details: {
        wallet: config.wallet.hexAddress,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function applyBalanceExposureGuard(
  config: ReturnType<typeof loadConfig>,
  memory: MemoryStore,
  plan: StoredTransactionPlan,
): Promise<void> {
  if (plan.kind !== 'PlaceBet' && plan.kind !== 'SubmitPodiumPick') return;
  if (plan.status === 'blocked') return;

  const checkIndex = plan.safetyChecks.findIndex((check) => check.name === 'balance_and_exposure');
  if (checkIndex < 0) return;

  try {
    const userBets = await new BolaoChainClient(config).queryBetsByUser(config.wallet.hexAddress);
    const evaluation = await evaluateBalanceExposure({
      config,
      plan,
      userBets,
      storedPlans: memory.listTransactionPlans(),
    });

    if (evaluation.blocked) {
      blockPlanWithSafetyCheck(plan, checkIndex, evaluation.check);
      return;
    }

    plan.safetyChecks[checkIndex] = evaluation.check;
    plan.updatedAt = new Date().toISOString();
  } catch (error) {
    blockPlanWithSafetyCheck(plan, checkIndex, {
      name: 'balance_and_exposure',
      status: 'fail',
      message: 'Balance, max-stake, or exposure guard failed; blocking transaction because spending safety could not be proven.',
      details: {
        kind: plan.kind,
        valuePlanck: plan.valuePlanck,
        maxStakePlanck: config.policy.maxStakePlanck,
        maxTournamentExposurePlanck: config.policy.maxTournamentExposurePlanck,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function blockPlanWithSafetyCheck(
  plan: StoredTransactionPlan,
  checkIndex: number,
  check: StoredTransactionPlan['safetyChecks'][number],
): void {
  plan.safetyChecks[checkIndex] = check;
  plan.status = 'blocked';
  plan.requiresApproval = true;
  plan.updatedAt = new Date().toISOString();
}

function buildOutcomeEvaluation(
  decision: DecisionReport,
  match: BolaoMatch,
  claimStatusOrError: unknown,
  transactionResults: StoredTransactionResult[],
): StoredOutcomeEvaluation {
  const evaluatedAt = new Date().toISOString();
  const finalized = match.result.kind === 'Finalized' ? match.result.value : null;
  const actualScore = finalized?.score ?? null;
  const actualPenaltyWinner = finalized?.penalty_winner ?? null;
  const actualOutcome = actualScore ? outcomeForScore(actualScore) : null;
  const exact = Boolean(
    actualScore &&
      decision.selected.score.home === actualScore.home &&
      decision.selected.score.away === actualScore.away &&
      decision.selected.penaltyWinner === actualPenaltyWinner,
  );
  const outcomeCorrect = Boolean(actualOutcome && decision.selected.outcome === actualOutcome);
  const phaseWeight = decision.tournament.phaseWeight;
  const scoring = decision.sourceSnapshots.tournamentProfile.scoring;
  const awardedBasePoints = finalized
    ? exact
      ? scoring.exactScorePoints
      : outcomeCorrect
        ? scoring.correctOutcomePoints
        : scoring.incorrectPoints
    : null;
  const awardedWeightedPoints =
    awardedBasePoints === null ? null : scoring.phaseWeightsApply ? awardedBasePoints * phaseWeight : awardedBasePoints;
  const payout = finalized
    ? payoutFromClaimStatus(claimStatusOrError)
    : {
        status: 'pending' as const,
        amountClaimablePlanck: null,
        alreadyClaimed: null,
      };
  const executionIssue = transactionResults.some((result) =>
    result.status === 'submission_blocked' || result.status === 'failed' || result.status === 'unknown',
  );
  const errorClassification = classifyEvaluation({
    finalized: Boolean(finalized),
    exact,
    outcomeCorrect,
    executionIssue,
    payoutStatus: payout.status,
  });
  const notes = buildEvaluationNotes({
    resultStatus: match.result.kind,
    exact,
    outcomeCorrect,
    executionIssue,
    payoutStatus: payout.status,
    claimStatusOrError,
  });

  return {
    id: `evaluation-${decision.id}-${evaluatedAt.replace(/[:.]/g, '-')}`,
    decisionId: decision.id,
    matchId: decision.matchId,
    evaluatedAt,
    status: finalized ? 'evaluated' : 'pending',
    predicted: {
      score: decision.selected.score,
      outcome: decision.selected.outcome,
      penaltyWinner: decision.selected.penaltyWinner,
    },
    actual: {
      resultStatus: match.result.kind,
      score: actualScore,
      outcome: actualOutcome,
      penaltyWinner: actualPenaltyWinner,
      finalizedAt: match.finalized_at,
    },
    points: {
      awardedBasePoints,
      awardedWeightedPoints,
      phaseWeight,
    },
    payout,
    errorClassification,
    notes,
    chainReadback: {
      match,
      claimStatus: claimStatusOrError instanceof Error ? { error: claimStatusOrError.message } : claimStatusOrError,
      transactionResults,
    },
    payload: {
      exact,
      outcomeCorrect,
      modelVersions: decision.modelVersions,
      decisionSummary: decision.summary,
    },
  };
}

function buildMemoryReport(input: {
  predictions: ReturnType<MemoryStore['listPredictions']>;
  decisions: DecisionReport[];
  transactionPlans: StoredTransactionPlan[];
  transactionResults: StoredTransactionResult[];
  outcomeEvaluations: StoredOutcomeEvaluation[];
}) {
  const evaluated = input.outcomeEvaluations.filter((evaluation) => evaluation.status === 'evaluated');
  const pending = input.outcomeEvaluations.filter((evaluation) => evaluation.status === 'pending');
  const decisionsById = new Map(input.decisions.map((decision) => [decision.id, decision]));
  const evaluatedWithDecision = evaluated
    .map((evaluation) => ({ evaluation, decision: decisionsById.get(evaluation.decisionId) ?? null }))
    .filter((entry): entry is { evaluation: StoredOutcomeEvaluation; decision: DecisionReport } => Boolean(entry.decision));
  const exactHits = evaluated.filter((evaluation) => scoresEqual(evaluation.predicted.score, evaluation.actual.score)).length;
  const outcomeHits = evaluated.filter((evaluation) => evaluation.actual.outcome === evaluation.predicted.outcome).length;
  const weightedPoints = evaluated.reduce(
    (sum, evaluation) => sum + (evaluation.points.awardedWeightedPoints ?? 0),
    0,
  );
  const expectedWeightedPoints = evaluatedWithDecision.reduce(
    (sum, entry) => sum + (entry.decision.economics.expectedWeightedPoints ?? 0),
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    storage: {
      sqlitePath: process.env.SMARTPREDICTOR_SQLITE_PATH ?? 'data/smartcup-agent.memory.sqlite',
      jsonMirrorPath: 'data/smartcup-agent.memory.json',
    },
    summary: {
      predictions: input.predictions.length,
      manualPredictions: input.predictions.filter((prediction) => prediction.source === 'manual').length,
      decisions: input.decisions.length,
      transactionPlans: input.transactionPlans.length,
      transactionResults: input.transactionResults.length,
      outcomeEvaluations: input.outcomeEvaluations.length,
      pendingEvaluations: pending.length,
      evaluatedDecisions: evaluated.length,
    },
    calibration: {
      evaluatedDecisions: evaluated.length,
      exactHits,
      exactHitRate: rate(exactHits, evaluated.length),
      outcomeHits,
      outcomeHitRate: rate(outcomeHits, evaluated.length),
      awardedWeightedPoints: roundForDisplay(weightedPoints),
      expectedWeightedPoints: roundForDisplay(expectedWeightedPoints),
      pointsDelta: roundForDisplay(weightedPoints - expectedWeightedPoints),
      averageConfidence: average(evaluatedWithDecision.map((entry) => entry.decision.selected.confidence)),
      byRiskMode: groupEvaluationsByRiskMode(evaluatedWithDecision),
      byErrorClassification: countBy(input.outcomeEvaluations, (evaluation) => evaluation.errorClassification),
      byPayoutStatus: countBy(input.outcomeEvaluations, (evaluation) => evaluation.payout.status),
    },
    predictionHistory: input.predictions.map((prediction) => ({
      id: prediction.id,
      source: prediction.source,
      walletAddress: prediction.walletAddress,
      matchId: prediction.matchId,
      score: prediction.score,
      penaltyWinner: prediction.penaltyWinner,
      predictedOutcome: prediction.predictedOutcome,
      amountPlanck: prediction.amountPlanck,
      matchPoolAmountPlanck: prediction.matchPoolAmountPlanck,
      createdAt: prediction.createdAt,
    })),
    decisions: input.decisions.map((decision) => ({
      id: decision.id,
      generatedAt: decision.generatedAt,
      matchId: decision.matchId,
      riskMode: decision.riskMode,
      recommendation: decision.summary.recommendation,
      selected: decision.selected,
      expectedWeightedPoints: decision.economics.expectedWeightedPoints,
      expectedRoi: decision.economics.expectedRoi,
      topFiveProbability: decision.economics.topFiveProbability,
      modelVersions: decision.modelVersions,
      sourceWarnings: decision.sourceWarnings,
    })),
    transactionAudit: {
      plans: input.transactionPlans.map((plan) => ({
        id: plan.id,
        createdAt: plan.createdAt,
        decisionId: plan.decisionId,
        kind: plan.kind,
        status: plan.status,
        wallet: plan.wallet,
        method: plan.method,
        valuePlanck: plan.valuePlanck,
        riskMode: plan.riskMode,
        requiresApproval: plan.requiresApproval,
        failedSafetyChecks: plan.safetyChecks.filter((check) => check.status === 'fail'),
      })),
      results: input.transactionResults.map((result) => ({
        id: result.id,
        planId: result.planId,
        createdAt: result.createdAt,
        status: result.status,
        txHash: result.txHash,
        messageId: result.messageId,
        blockNumber: result.blockNumber,
        error: result.error,
      })),
    },
    evaluationHistory: input.outcomeEvaluations.map((evaluation) => ({
      id: evaluation.id,
      decisionId: evaluation.decisionId,
      matchId: evaluation.matchId,
      evaluatedAt: evaluation.evaluatedAt,
      status: evaluation.status,
      predicted: evaluation.predicted,
      actual: evaluation.actual,
      points: evaluation.points,
      payout: evaluation.payout,
      errorClassification: evaluation.errorClassification,
      notes: evaluation.notes,
    })),
  };
}

type MemoryAuditReport = ReturnType<typeof buildMemoryReport>;

function renderMemoryReportSummary(report: MemoryAuditReport): string {
  const latestDecision = report.decisions[report.decisions.length - 1] ?? null;
  const latestPlan = report.transactionAudit.plans[report.transactionAudit.plans.length - 1] ?? null;
  const latestResult = report.transactionAudit.results[report.transactionAudit.results.length - 1] ?? null;
  const failedPlans = report.transactionAudit.plans.filter((plan) => plan.failedSafetyChecks.length > 0).length;
  const errorBreakdown = Object.entries(report.calibration.byErrorClassification)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');

  const lines = [
    'SmartPredictor memory report',
    `Generated: ${report.generatedAt}`,
    `SQLite: ${report.storage.sqlitePath}`,
    '',
    'Counts:',
    `- Predictions: ${report.summary.predictions} (${report.summary.manualPredictions} manual)`,
    `- Saved decisions: ${report.summary.decisions}`,
    `- Transactions: ${report.summary.transactionPlans} plans, ${report.summary.transactionResults} results`,
    `- Evaluations: ${report.summary.evaluatedDecisions} evaluated, ${report.summary.pendingEvaluations} pending`,
    '',
    'Calibration snapshot:',
    `- Exact hits: ${report.calibration.exactHits}/${report.calibration.evaluatedDecisions} (${formatRateForSummary(report.calibration.exactHitRate)})`,
    `- Outcome hits: ${report.calibration.outcomeHits}/${report.calibration.evaluatedDecisions} (${formatRateForSummary(report.calibration.outcomeHitRate)})`,
    `- Weighted points: awarded ${report.calibration.awardedWeightedPoints}, expected ${report.calibration.expectedWeightedPoints}, delta ${report.calibration.pointsDelta}`,
  ];

  if (report.calibration.averageConfidence !== null) {
    lines.push(`- Average confidence: ${roundForDisplay(report.calibration.averageConfidence)}`);
  }
  if (errorBreakdown) {
    lines.push(`- Error classifications: ${errorBreakdown}`);
  }

  lines.push('');
  lines.push('Latest saved decision:');
  if (latestDecision) {
    lines.push(
      `- ${latestDecision.id} | match ${latestDecision.matchId} | ${latestDecision.riskMode} | ${latestDecision.recommendation}`,
    );
    lines.push(
      `- confidence ${roundForDisplay(latestDecision.selected.confidence)} | expected points ${latestDecision.expectedWeightedPoints} | ROI ${latestDecision.expectedRoi}`,
    );
    if (latestDecision.sourceWarnings.length > 0) {
      lines.push(`- source warnings: ${latestDecision.sourceWarnings.length}`);
    }
  } else {
    lines.push('- none yet');
  }

  lines.push('');
  lines.push('Transaction health:');
  lines.push(`- Plans with failed safety checks: ${failedPlans}`);
  if (latestPlan) {
    lines.push(`- Latest plan: ${latestPlan.id} | ${latestPlan.kind} | ${latestPlan.status}`);
  }
  if (latestResult) {
    lines.push(`- Latest result: ${latestResult.id} | ${latestResult.status}${latestResult.txHash ? ` | ${latestResult.txHash}` : ''}`);
  }

  lines.push('');
  lines.push('Focused commands:');
  lines.push('- `npm run list-reports -- --format summary` for saved DecisionReports');
  lines.push('- `npm run export-report -- --format markdown` or `--format json` for report exports');
  lines.push('- `npm run calibration -- --format summary` for post-match calibration');
  lines.push('- `npm run report -- --format json` for the full audit JSON');
  lines.push('- `npm run report -- --full true` for full audit JSON plus raw stored records');

  return lines.join('\n');
}

function formatRateForSummary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return `${roundForDisplay(value * 100)}%`;
}

function groupEvaluationsByRiskMode(
  entries: Array<{ evaluation: StoredOutcomeEvaluation; decision: DecisionReport }>,
): Record<string, { count: number; exactHitRate: number; outcomeHitRate: number; averageConfidence: number }> {
  const groups = new Map<string, Array<{ evaluation: StoredOutcomeEvaluation; decision: DecisionReport }>>();
  for (const entry of entries) {
    const existing = groups.get(entry.decision.riskMode) ?? [];
    existing.push(entry);
    groups.set(entry.decision.riskMode, existing);
  }

  const result: Record<string, { count: number; exactHitRate: number; outcomeHitRate: number; averageConfidence: number }> = {};
  for (const [riskMode, group] of groups) {
    result[riskMode] = {
      count: group.length,
      exactHitRate: rate(
        group.filter((entry) => scoresEqual(entry.evaluation.predicted.score, entry.evaluation.actual.score)).length,
        group.length,
      ),
      outcomeHitRate: rate(
        group.filter((entry) => entry.evaluation.actual.outcome === entry.evaluation.predicted.outcome).length,
        group.length,
      ),
      averageConfidence: average(group.map((entry) => entry.decision.selected.confidence)),
    };
  }
  return result;
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = keyFn(value);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return roundForDisplay(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function rate(count: number, total: number): number {
  if (total <= 0) return 0;
  return roundForDisplay(count / total);
}

function scoresEqual(left: Score, right: Score | null): boolean {
  return Boolean(right && left.home === right.home && left.away === right.away);
}

function payoutFromClaimStatus(value: unknown): StoredOutcomeEvaluation['payout'] {
  if (value instanceof Error) {
    return {
      status: 'unknown',
      amountClaimablePlanck: null,
      alreadyClaimed: null,
    };
  }

  if (value && typeof value === 'object' && 'already_claimed' in value && 'amount_claimable' in value) {
    const status = value as { already_claimed: boolean; amount_claimable: string };
    return {
      status: status.already_claimed ? 'claimed' : status.amount_claimable !== '0' ? 'claimable' : 'pending',
      amountClaimablePlanck: status.amount_claimable,
      alreadyClaimed: status.already_claimed,
    };
  }

  return {
    status: 'not_available',
    amountClaimablePlanck: null,
    alreadyClaimed: null,
  };
}

function classifyEvaluation(input: {
  finalized: boolean;
  exact: boolean;
  outcomeCorrect: boolean;
  executionIssue: boolean;
  payoutStatus: StoredOutcomeEvaluation['payout']['status'];
}): StoredOutcomeEvaluation['errorClassification'] {
  if (!input.finalized) return 'pending_result';
  if (input.executionIssue) return 'execution';
  if (input.exact) return input.payoutStatus === 'unknown' ? 'payout_pending' : 'none';
  if (!input.outcomeCorrect) return 'football_model';
  return 'scoreline_strategy';
}

function buildEvaluationNotes(input: {
  resultStatus: string;
  exact: boolean;
  outcomeCorrect: boolean;
  executionIssue: boolean;
  payoutStatus: StoredOutcomeEvaluation['payout']['status'];
  claimStatusOrError: unknown;
}): string[] {
  const notes = [`Chain result status is ${input.resultStatus}.`];
  if (input.resultStatus !== 'Finalized') notes.push('Match is not finalized yet; points and payout remain pending.');
  if (input.resultStatus === 'Finalized' && input.exact) notes.push('Selected exact score matched the finalized result.');
  if (input.resultStatus === 'Finalized' && !input.exact && input.outcomeCorrect) {
    notes.push('Outcome was correct but exact score missed.');
  }
  if (input.resultStatus === 'Finalized' && !input.outcomeCorrect) notes.push('Outcome missed; classify as football-model error.');
  if (input.executionIssue) notes.push('A stored transaction result indicates execution was blocked or failed.');
  if (input.claimStatusOrError instanceof Error) {
    notes.push(`Payout claim status could not be read: ${input.claimStatusOrError.message}`);
  } else {
    notes.push(`Payout status is ${input.payoutStatus}.`);
  }
  return notes;
}

function outcomeForScore(score: Score): PoolOutcome {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function selectPenaltyWinner(
  outcome: PoolOutcome,
  probabilities: { Home: number; Away: number } | undefined,
): PenaltyWinner | null {
  if (outcome !== 'draw' || !probabilities) return null;
  return probabilities.Home >= probabilities.Away ? 'Home' : 'Away';
}

function confidenceFrom(utility: number, exactProbability: number): number {
  return roundForDisplay(Math.max(0, Math.min(1, utility * 0.7 + exactProbability * 0.3)));
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function roundForDisplay(value: number): number {
  return Number(value.toFixed(6));
}

function toSmartCupMatch(match: BolaoMatch): SmartCupMatch {
  return {
    matchId: match.match_id,
    phase: match.phase,
    home: match.home,
    away: match.away,
    kickOffMs: Number(match.kick_off),
    status: toMatchStatus(match),
  };
}

function toMatchStatus(match: BolaoMatch): MatchStatus {
  if (match.result.kind === 'Cancelled') return 'CANCELLED';
  if (match.settlement_prepared) return 'SETTLED';
  if (match.result.kind === 'Finalized') return 'FINALIZED';
  if (match.result.kind === 'Proposed') return 'PROPOSED';
  return 'UNRESOLVED';
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      result[key] = 'true';
      continue;
    }
    result[key] = value;
    index += 1;
  }

  return result;
}

type TelegramNaturalLanguageSmokeInput = {
  texts: string[];
  userId: string;
  chatId: string;
  hasWizardSession: boolean;
  saveTelemetry: boolean;
  memory: MemoryStore;
};

type TelegramNaturalLanguageSmokeMessage = {
  rawTextHash: `0x${string}`;
  rawTextLength: number;
  route: {
    kind: ReturnType<typeof resolveTelegramMessageRoute>['kind'];
    command?: string;
  };
  parsed: ReturnType<typeof parseTelegramNaturalLanguage> | null;
  clarification: ReturnType<typeof buildTelegramNaturalLanguageClarification> | null;
  permissionAllowed: boolean | null;
  actionTaken: ParserTelemetryActionTaken | null;
  safetyOutcome: ParserTelemetrySafetyOutcome | null;
  telemetrySaved: boolean;
  notes: string[];
};

type TelegramPrivateSmokeInput = {
  regularUserId: string;
  adminUserId: string;
  memoryPath: string;
  sqlitePath: string;
  saveTelemetry: boolean;
};

type TelegramPrivateSmokeResult = {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
};

type TelegramPrivateSmokeReport = {
  generatedAt: string;
  ok: boolean;
  contactedTelegram: false;
  caseCount: number;
  passed: number;
  memoryPath: string;
  sqlitePath: string;
  results: TelegramPrivateSmokeResult[];
  notes: string[];
};

async function buildTelegramNaturalLanguageSmokeReport(
  config: ReturnType<typeof loadConfig>,
  input: TelegramNaturalLanguageSmokeInput,
): Promise<{
  generatedAt: string;
  contactedTelegram: false;
  userId: string;
  chatIdHash: `0x${string}`;
  messageCount: number;
  telemetrySaveRequested: boolean;
  messages: TelegramNaturalLanguageSmokeMessage[];
}> {
  const tournaments = await listTournamentProfileOptions(config.artifacts.tournamentProfilePath);
  const permissionModel = new TelegramPermissionModel(config);
  const messages: TelegramNaturalLanguageSmokeMessage[] = [];

  for (const text of input.texts) {
    const route = resolveTelegramMessageRoute(text, { hasWizardSession: input.hasWizardSession });
    if (route.kind !== 'natural_language') {
      const routedCommand = route.kind === 'slash_command' || route.kind === 'unknown_slash_command' ? route.command : null;
      messages.push({
        rawTextHash: hashCliText(text),
        rawTextLength: text.length,
        route: { kind: route.kind, ...(routedCommand ? { command: routedCommand } : {}) },
        parsed: null,
        clarification: null,
        permissionAllowed: routedCommand
          ? permissionModel.canRun(routedCommand, { id: input.userId }).allowed
          : null,
        actionTaken: null,
        safetyOutcome: null,
        telemetrySaved: false,
        notes: ['Message did not enter natural-language parser because router precedence selected another path.'],
      });
      continue;
    }

    const parsed = parseTelegramNaturalLanguage(text, {
      tournaments: tournaments.map((tournament) => ({
        id: tournament.tournamentId,
        name: tournament.name,
        slug: tournament.slug,
        aliases: [tournament.tournamentId, tournament.name, tournament.slug],
      })),
    });
    const clarification = buildTelegramNaturalLanguageClarification(parsed);
    const operatorCommand = parsed.permission === 'operator' ? smokeOperatorCommand(parsed.intent) : null;
    const permissionAllowed = operatorCommand
      ? permissionModel.canRun(operatorCommand, { id: input.userId }).allowed
      : true;
    const decisionExists =
      parsed.intent === 'approve_plan' && parsed.slots.decisionId
        ? input.memory.listDecisions().some((decision) => decision.id === parsed.slots.decisionId)
        : null;
    const duplicatePredictionExists =
      parsed.intent === 'approve_plan' && parsed.slots.decisionId
        ? approvalDecisionHasLocalDuplicate(config, input.memory, parsed.slots.decisionId)
        : null;
    const { actionTaken, safetyOutcome, notes } = classifyNaturalLanguageSmoke(
      parsed,
      clarification,
      permissionAllowed,
      decisionExists,
      duplicatePredictionExists,
    );
    let telemetrySaved = false;

    if (input.saveTelemetry) {
      const entry = buildSmokeParserTelemetry({
        text,
        chatId: input.chatId,
        userId: input.userId,
        parsed,
        actionTaken,
        safetyOutcome,
        details: {
          harness: 'telegram-nl-smoke',
          route: route.kind,
          permissionAllowed,
          notes,
        },
      });
      input.memory.saveParserTelemetry(entry);
      telemetrySaved = true;
    }

    messages.push({
      rawTextHash: hashCliText(text),
      rawTextLength: text.length,
      route: { kind: route.kind },
      parsed,
      clarification,
      permissionAllowed,
      actionTaken,
      safetyOutcome,
      telemetrySaved,
      notes,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    contactedTelegram: false,
    userId: input.userId,
    chatIdHash: hashCliText(input.chatId),
    messageCount: messages.length,
    telemetrySaveRequested: input.saveTelemetry,
    messages,
  };
}

function classifyNaturalLanguageSmoke(
  parsed: ReturnType<typeof parseTelegramNaturalLanguage>,
  clarification: ReturnType<typeof buildTelegramNaturalLanguageClarification>,
  permissionAllowed: boolean,
  decisionExists: boolean | null,
  duplicatePredictionExists: boolean | null,
): {
  actionTaken: ParserTelemetryActionTaken;
  safetyOutcome: ParserTelemetrySafetyOutcome;
  notes: string[];
} {
  if (!permissionAllowed) {
    return {
      actionTaken: 'permission_denied',
      safetyOutcome: 'permission_denied',
      notes: ['Operator intent would be denied because user id is not in TELEGRAM_ADMIN_IDS.'],
    };
  }
  if (
    parsed.slots.matchScope === 'next_open_match' &&
    (parsed.intent === 'leaderboard_analysis' ||
      parsed.intent === 'decision_preview' ||
      parsed.intent === 'market_analysis' ||
      parsed.intent === 'timing_strategy' ||
      parsed.intent === 'crowd_contrarian_map' ||
      parsed.intent === 'football_context_risk' ||
      parsed.intent === 'tournament_position_strategy' ||
      parsed.intent === 'alternative_pick_set')
  ) {
    return parsed.intent === 'leaderboard_analysis'
      ? smokeClass('operator_leaderboard_analysis', 'read_only', [
          'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
          'Smoke harness does not run the leaderboard simulator.',
        ])
      : parsed.intent === 'market_analysis'
        ? smokeClass('operator_market_analysis', 'decision_preview_saved', [
            'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
            'Smoke harness does not run the market comparison engine.',
          ])
        : parsed.intent === 'timing_strategy'
          ? smokeClass('operator_timing_strategy', 'decision_preview_saved', [
              'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
              'Smoke harness does not run the timing strategy engine.',
            ])
          : parsed.intent === 'crowd_contrarian_map'
            ? smokeClass('operator_crowd_contrarian_map', 'decision_preview_saved', [
                'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
                'Smoke harness does not run the crowd contrarian map engine.',
              ])
            : parsed.intent === 'football_context_risk'
              ? smokeClass('operator_football_context_risk', 'decision_preview_saved', [
                  'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
                  'Smoke harness does not run the football context risk engine.',
                ])
              : parsed.intent === 'tournament_position_strategy'
                ? smokeClass('operator_tournament_position_strategy', 'decision_preview_saved', [
                    'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
                    'Smoke harness does not run the tournament-position strategy engine.',
                  ])
                : parsed.intent === 'alternative_pick_set'
                  ? smokeClass('operator_alternative_pick_set', 'decision_preview_saved', [
                      'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
                      'Smoke harness does not run the alternative pick-set engine.',
                    ])
      : smokeClass('operator_decision_preview', 'decision_preview_saved', [
          'Live Telegram resolves next_open_match through the eligible-match picker before routing.',
          'Smoke harness does not run the decision engine.',
        ]);
  }
  if (clarification.requiresClarification) {
    return {
      actionTaken: 'clarification_prompt',
      safetyOutcome: 'clarification_required',
      notes: ['Message requires clarification before routing.'],
    };
  }

  if (parsed.intent === 'help') return smokeClass('user_help', 'read_only');
  if (parsed.intent === 'agent_status') return smokeClass('user_agent_status', 'read_only');
  if (parsed.intent === 'tournament_select') return smokeClass('user_tournament_select', 'read_only');
  if (parsed.intent === 'eligible_matches') return smokeClass('user_eligible_matches', 'read_only');
  if (parsed.intent === 'freebet_status') return smokeClass('user_freebet_status', 'read_only');
  if (parsed.intent === 'refund_status') return smokeClass('user_refund_status', 'read_only');
  if (parsed.intent === 'strategy_preferences') {
    return smokeClass(
      'user_strategy_preferences',
      parsed.slots.riskMode ? 'local_preference_stored' : 'read_only',
      ['Live Telegram writes strategy preferences through the persistent Telegram preference store.'],
    );
  }
  if (parsed.intent === 'leaderboard_analysis') return smokeClass('operator_leaderboard_analysis', 'read_only', [
    'Smoke harness does not run the leaderboard simulator.',
  ]);
  if (parsed.intent === 'market_analysis') return smokeClass('operator_market_analysis', 'decision_preview_saved', [
    'Smoke harness does not run the market comparison engine.',
  ]);
  if (parsed.intent === 'timing_strategy') return smokeClass('operator_timing_strategy', 'decision_preview_saved', [
    'Smoke harness does not run the timing strategy engine.',
  ]);
  if (parsed.intent === 'crowd_contrarian_map') return smokeClass('operator_crowd_contrarian_map', 'decision_preview_saved', [
    'Smoke harness does not run the crowd contrarian map engine.',
  ]);
  if (parsed.intent === 'football_context_risk') return smokeClass('operator_football_context_risk', 'decision_preview_saved', [
    'Smoke harness does not run the football context risk engine.',
  ]);
  if (parsed.intent === 'tournament_position_strategy') return smokeClass('operator_tournament_position_strategy', 'decision_preview_saved', [
    'Smoke harness does not run the tournament-position strategy engine.',
  ]);
  if (parsed.intent === 'alternative_pick_set') return smokeClass('operator_alternative_pick_set', 'decision_preview_saved', [
    'Smoke harness does not run the alternative pick-set engine.',
  ]);
  if (parsed.intent === 'saved_reports') return smokeClass('operator_saved_reports', 'read_only', [
    'Smoke harness does not read saved reports; live Telegram lists reports through the selected tournament context.',
  ]);
  if (parsed.intent === 'personal_bundle') return smokeClass('operator_personal_bundle', 'read_only', [
    'Smoke harness does not build the five-match bundle; live Telegram uses the personal bundle handler.',
  ]);
  if (parsed.intent === 'personal_podium_strategy') return smokeClass('operator_personal_podium_strategy', 'read_only', [
    'Smoke harness does not build podium strategy; live Telegram uses the personal podium handler.',
  ]);
  if (parsed.intent === 'personal_tournament_advisory') return smokeClass('operator_personal_tournament_advisory', 'read_only', [
    'Smoke harness does not build tournament advisory; live Telegram uses the personal advisory handler.',
  ]);
  if (parsed.intent === 'calibration_report') return smokeClass('operator_calibration_report', 'read_only', [
    'Smoke harness does not build calibration; live Telegram renders local post-match calibration.',
  ]);
  if (parsed.intent === 'export_report') return smokeClass('operator_export_report', 'read_only', [
    'Smoke harness does not export reports; live Telegram opens the personal report export flow.',
  ]);
  if (parsed.intent === 'decision_preview') return smokeClass('operator_decision_preview', 'decision_preview_saved', [
    'Smoke harness does not run the decision engine.',
  ]);
  if (parsed.intent === 'operator_policy') return smokeClass('operator_policy', 'policy_change', [
    'Smoke harness does not mutate .env or running bot config.',
  ]);
  if (parsed.intent === 'approve_plan') {
    if (!decisionExists) {
      return smokeClass('operator_approval_rejected', 'blocked', [
        'Saved decision id was not found in local memory. Natural-language approval remains blocked.',
      ]);
    }
    if (duplicatePredictionExists) {
      return smokeClass('operator_approval_rejected', 'blocked', [
        'Local prediction memory already has this match for the operator wallet. Natural-language duplicate approval remains blocked.',
      ]);
    }
    return smokeClass('operator_approval_button_rendered', 'explicit_button_required', [
      'Smoke harness never executes approval; live path still requires saved decision and button callback.',
    ]);
  }

  return smokeClass('parser_preview', 'no_action');
}

function smokeClass(
  actionTaken: ParserTelemetryActionTaken,
  safetyOutcome: ParserTelemetrySafetyOutcome,
  notes: string[] = [],
): {
  actionTaken: ParserTelemetryActionTaken;
  safetyOutcome: ParserTelemetrySafetyOutcome;
  notes: string[];
} {
  return { actionTaken, safetyOutcome, notes };
}

async function runTelegramPrivateSmokeSuite(
  config: ReturnType<typeof loadConfig>,
  input: TelegramPrivateSmokeInput,
): Promise<TelegramPrivateSmokeReport> {
  const smokeConfig = {
    ...config,
    policy: {
      ...config.policy,
      mode: 'read_only' as const,
    },
    telegram: {
      ...config.telegram,
      adminIds: [...new Set([...config.telegram.adminIds, input.adminUserId])],
    },
  };
  const memory = new MemoryStore(input.memoryPath, input.sqlitePath);
  const results: TelegramPrivateSmokeResult[] = [];
  const duplicateDecision = buildPrivateSmokeDecision(smokeConfig, {
    id: 'decision-private-smoke-duplicate-match-3',
    matchId: '3',
  });
  memory.saveDecision(duplicateDecision);
  memory.savePrediction(buildPrivateSmokePrediction(smokeConfig, duplicateDecision));
  const userPreference = buildPrivateSmokePreference({
    userId: input.regularUserId,
    tournamentId: 'worldcup-2026-mvp',
    role: 'user',
    patch: {
      defaultRiskMode: 'contrarian',
      simulationObjective: 'balanced',
      strategyPosture: 'catch_up',
    },
  });
  const operatorPreference = buildPrivateSmokePreference({
    userId: input.adminUserId,
    tournamentId: 'worldcup-2026-mvp',
    role: 'operator',
    patch: {
      defaultRiskMode: 'balanced',
      simulationObjective: 'protect_lead',
      strategyPosture: 'protect_lead',
    },
  });
  memory.saveTelegramPreference(userPreference);
  memory.saveTelegramPreference(operatorPreference);

  results.push(assertPrivateSmokePreference(memory, userPreference));
  results.push(assertPrivateSmokePreference(memory, operatorPreference));
  results.push(
    await assertPrivateSmokePreferenceApplied({
      name: 'preference application: operator decide inherits risk',
      actual: await applyOperatorPreferencesToCommandText({
        config: smokeConfig,
        memory,
        user: { id: input.adminUserId },
        text: '/operator_decide match:4 tournament:worldcup-2026-mvp',
        command: 'operator_decide',
      }),
      expectedIncludes: ['risk:balanced'],
    }),
  );
  results.push(
    await assertPrivateSmokePreferenceApplied({
      name: 'preference application: operator simulate inherits objective',
      actual: await applyOperatorPreferencesToCommandText({
        config: smokeConfig,
        memory,
        user: { id: input.adminUserId },
        text: '/operator_simulate match:4 tournament:worldcup-2026-mvp',
        command: 'operator_simulate',
      }),
      expectedIncludes: ['objective:protect_lead'],
    }),
  );
  const activeTournament = (await listTournamentProfileOptions(smokeConfig.artifacts.tournamentProfilePath))[0] ?? null;
  results.push(assertPrivateSmokeMenuIsolation());
  if (activeTournament) {
    results.push(assertPrivateSmokeMenuCopy(activeTournament));
    results.push(assertPrivateSmokeFriendlyOutputHygiene(activeTournament, duplicateDecision));
    results.push(assertPrivateSmokePredictionClosingAlerts(smokeConfig, memory, activeTournament));
  } else {
    results.push({
      name: 'menu copy isolation: tournament profile available',
      ok: false,
      expected: 'at least one configured tournament profile',
      actual: 'no tournament profile found',
    });
  }

  const smoke = async (params: {
    name: string;
    text: string;
    userId: string;
    expect: {
      routeKind?: string;
      intent?: string;
      actionTaken?: ParserTelemetryActionTaken | null;
      safetyOutcome?: ParserTelemetrySafetyOutcome | null;
      permissionAllowed?: boolean | null;
      ambiguousSlot?: string;
      missingSlot?: string;
      slotEquals?: Record<string, unknown>;
      absentSlots?: string[];
    };
  }) => {
    const report = await buildTelegramNaturalLanguageSmokeReport(smokeConfig, {
      texts: [params.text],
      userId: params.userId,
      chatId: `private-smoke-${params.userId}`,
      hasWizardSession: false,
      saveTelemetry: input.saveTelemetry,
      memory,
    });
    const message = report.messages[0];
    if (!message) {
      results.push({
        name: params.name,
        ok: false,
        expected: JSON.stringify(params.expect),
        actual: 'No smoke message returned.',
      });
      return;
    }
    results.push(assertSmokeMessage(params.name, message, params.expect));
  };

  await smoke({
    name: 'user phrase: agent status',
    text: 'how am I doing?',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'agent_status',
      actionTaken: 'user_agent_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'regression: tournament status question does not extract stopword id',
    text: 'what tournament am I using?',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'agent_status',
      actionTaken: 'user_agent_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      absentSlots: ['tournamentId'],
    },
  });
  await smoke({
    name: 'regression: active tournament question routes to status',
    text: 'which tournament is active?',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'agent_status',
      actionTaken: 'user_agent_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      absentSlots: ['tournamentId'],
    },
  });
  await smoke({
    name: 'regression: show active tournament routes to status',
    text: 'show active tournament',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'agent_status',
      actionTaken: 'user_agent_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      absentSlots: ['tournamentId'],
    },
  });
  await smoke({
    name: 'regression: menu phrase opens guided menu',
    text: 'show me the menu option',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'tournament_select',
      actionTaken: 'user_tournament_select',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'regression: switch tournament to World Cup resolves profile',
    text: 'switch tournament to World Cup',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'tournament_select',
      actionTaken: 'user_tournament_select',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      slotEquals: { tournamentId: 'worldcup-2026-mvp' },
    },
  });
  await smoke({
    name: 'regression: select SmartCup World Cup alias resolves profile',
    text: 'select SmartCup World Cup',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'tournament_select',
      actionTaken: 'user_tournament_select',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      slotEquals: { tournamentId: 'worldcup-2026-mvp' },
    },
  });
  await smoke({
    name: 'regression: use profile slug resolves tournament',
    text: 'use tournament worldcup-2026.mvp',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'tournament_select',
      actionTaken: 'user_tournament_select',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      slotEquals: { tournamentId: 'worldcup-2026-mvp' },
    },
  });
  await smoke({
    name: 'user phrase: freebet status',
    text: 'check my freebet balance',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'freebet_status',
      actionTaken: 'user_freebet_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'user phrase: claim status',
    text: 'do I have anything to claim?',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'refund_status',
      actionTaken: 'user_refund_status',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'strategy preference NL: set risk to contrarian',
    text: 'set risk to contrarian',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'local_preference_stored',
      permissionAllowed: true,
      slotEquals: { riskMode: 'contrarian' },
    },
  });
  await smoke({
    name: 'strategy preference NL: use conservative mode',
    text: 'use conservative mode',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'local_preference_stored',
      permissionAllowed: true,
      slotEquals: { riskMode: 'conservative' },
    },
  });
  await smoke({
    name: 'strategy preference NL: vague conservative mode asks clarification',
    text: 'make it conservative',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'unknown',
      actionTaken: 'clarification_prompt',
      safetyOutcome: 'clarification_required',
      ambiguousSlot: 'riskMode',
    },
  });
  await smoke({
    name: 'strategy preference NL: change objective to catch up',
    text: 'change objective to catch up',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'local_preference_stored',
      permissionAllowed: true,
      slotEquals: { riskMode: 'catch_up' },
    },
  });
  await smoke({
    name: 'strategy preference NL: protect my lead',
    text: 'protect my lead',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'local_preference_stored',
      permissionAllowed: true,
      slotEquals: { riskMode: 'protect_lead' },
    },
  });
  await smoke({
    name: 'strategy preference NL: use final swing strategy',
    text: 'use final swing strategy',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'local_preference_stored',
      permissionAllowed: true,
      slotEquals: { riskMode: 'final_swing' },
    },
  });
  await smoke({
    name: 'strategy preference NL: show my strategy settings',
    text: 'show my strategy settings',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'strategy_preferences',
      actionTaken: 'user_strategy_preferences',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
      absentSlots: ['riskMode'],
    },
  });
  await smoke({
    name: 'operator phrase: decision preview allowed for admin',
    text: 'analyze match 4 with balanced risk and 3 dollars cash',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'decision_preview',
      actionTaken: 'operator_decision_preview',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: leaderboard analysis allowed for admin',
    text: 'analyze competitors and leaderboard for the next open match',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'leaderboard_analysis',
      actionTaken: 'operator_leaderboard_analysis',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: market comparison allowed for admin',
    text: 'compare the next open match to the bookmaker market',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'market_analysis',
      actionTaken: 'operator_market_analysis',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: timing strategy allowed for admin',
    text: 'should I predict now or wait for the next open match?',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'timing_strategy',
      actionTaken: 'operator_timing_strategy',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: crowd contrarian map allowed for admin',
    text: 'where is the crowd on the next open match?',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'crowd_contrarian_map',
      actionTaken: 'operator_crowd_contrarian_map',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: football context risk allowed for admin',
    text: 'lineup and injury risk for the next open match',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'football_context_risk',
      actionTaken: 'operator_football_context_risk',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: tournament-position strategy allowed for admin',
    text: 'tournament position strategy for the next open match',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'tournament_position_strategy',
      actionTaken: 'operator_tournament_position_strategy',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: alternative pick set allowed for admin',
    text: 'show safest balanced contrarian and leaderboard upside picks for the next open match',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'alternative_pick_set',
      actionTaken: 'operator_alternative_pick_set',
      safetyOutcome: 'decision_preview_saved',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: saved reports allowed for admin',
    text: 'show my saved reports',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'saved_reports',
      actionTaken: 'operator_saved_reports',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: personal bundle allowed for admin',
    text: 'build my personal five-match bundle',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'personal_bundle',
      actionTaken: 'operator_personal_bundle',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: personal podium strategy allowed for admin',
    text: 'give me my personal podium strategy',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'personal_podium_strategy',
      actionTaken: 'operator_personal_podium_strategy',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: personal tournament advisory allowed for admin',
    text: 'show my rolling tournament plan',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'personal_tournament_advisory',
      actionTaken: 'operator_personal_tournament_advisory',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: calibration report allowed for admin',
    text: 'show calibration report for my predictions',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'calibration_report',
      actionTaken: 'operator_calibration_report',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: export report allowed for admin',
    text: 'export saved reports as markdown',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'export_report',
      actionTaken: 'operator_export_report',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: export latest report allowed for admin',
    text: 'export my latest report',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'export_report',
      actionTaken: 'operator_export_report',
      safetyOutcome: 'read_only',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: policy change allowed for admin',
    text: 'set policy read only',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'operator_policy',
      actionTaken: 'operator_policy',
      safetyOutcome: 'policy_change',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'operator phrase: mixed policy and risk asks clarification',
    text: 'make it conservative and read only',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'operator_policy',
      actionTaken: 'clarification_prompt',
      safetyOutcome: 'clarification_required',
      ambiguousSlot: 'riskMode',
    },
  });
  await smoke({
    name: 'operator phrase: denied for non-admin',
    text: 'analyze match 4 with balanced risk',
    userId: input.regularUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'decision_preview',
      actionTaken: 'permission_denied',
      safetyOutcome: 'permission_denied',
      permissionAllowed: false,
    },
  });
  await smoke({
    name: 'duplicate match approval: blocked locally',
    text: `approve decision ${duplicateDecision.id}`,
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'approve_plan',
      actionTaken: 'operator_approval_rejected',
      safetyOutcome: 'blocked',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'unknown decision approval: blocked locally',
    text: 'approve decision decision-private-smoke-missing',
    userId: input.adminUserId,
    expect: {
      routeKind: 'natural_language',
      intent: 'approve_plan',
      actionTaken: 'operator_approval_rejected',
      safetyOutcome: 'blocked',
      permissionAllowed: true,
    },
  });
  await smoke({
    name: 'slash command priority: help bypasses natural language',
    text: '/help',
    userId: input.regularUserId,
    expect: {
      routeKind: 'slash_command',
      actionTaken: null,
      safetyOutcome: null,
      permissionAllowed: true,
    },
  });

  const readOnlyPlan = buildPlaceBetTransactionPlan(smokeConfig, { decision: duplicateDecision });
  results.push({
    name: 'read-only blocking: PlaceBet plan is blocked before execution',
    ok:
      readOnlyPlan.status === 'blocked' &&
      readOnlyPlan.requiresApproval === true &&
      readOnlyPlan.safetyChecks.some((check) => check.name === 'policy_mode' && check.status === 'fail'),
    expected: 'status=blocked, requiresApproval=true, policy_mode safety check fail',
    actual: `status=${readOnlyPlan.status}, requiresApproval=${readOnlyPlan.requiresApproval}, policy=${readOnlyPlan.safetyChecks.find((check) => check.name === 'policy_mode')?.status ?? 'missing'}`,
  });

  const passed = results.filter((result) => result.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    ok: passed === results.length,
    contactedTelegram: false,
    caseCount: results.length,
    passed,
    memoryPath: input.memoryPath,
    sqlitePath: input.sqlitePath,
    results,
    notes: [
      'Private smoke suite uses local parser, permission, memory, and transaction-plan policy checks only.',
      'It does not contact Telegram, does not call live SmartCup reads, and does not execute transactions.',
    ],
  };
}

function assertSmokeMessage(
  name: string,
  message: TelegramNaturalLanguageSmokeMessage,
  expect: {
    routeKind?: string;
    intent?: string;
    actionTaken?: ParserTelemetryActionTaken | null;
    safetyOutcome?: ParserTelemetrySafetyOutcome | null;
    permissionAllowed?: boolean | null;
    ambiguousSlot?: string;
    missingSlot?: string;
    slotEquals?: Record<string, unknown>;
    absentSlots?: string[];
  },
): TelegramPrivateSmokeResult {
  const failures: string[] = [];
  if (expect.routeKind !== undefined && message.route.kind !== expect.routeKind) {
    failures.push(`route=${message.route.kind}`);
  }
  if (expect.intent !== undefined && message.parsed?.intent !== expect.intent) {
    failures.push(`intent=${message.parsed?.intent ?? 'null'}`);
  }
  if (expect.actionTaken !== undefined && message.actionTaken !== expect.actionTaken) {
    failures.push(`action=${message.actionTaken ?? 'null'}`);
  }
  if (expect.safetyOutcome !== undefined && message.safetyOutcome !== expect.safetyOutcome) {
    failures.push(`outcome=${message.safetyOutcome ?? 'null'}`);
  }
  if (expect.permissionAllowed !== undefined && message.permissionAllowed !== expect.permissionAllowed) {
    failures.push(`permission=${String(message.permissionAllowed)}`);
  }
  if (expect.ambiguousSlot && !message.parsed?.ambiguousSlots.includes(expect.ambiguousSlot as never)) {
    failures.push(`ambiguous=${message.parsed?.ambiguousSlots.join(',') || 'none'}`);
  }
  if (expect.missingSlot && !message.parsed?.missingRequiredSlots.includes(expect.missingSlot as never)) {
    failures.push(`missing=${message.parsed?.missingRequiredSlots.join(',') || 'none'}`);
  }
  for (const [slot, expectedValue] of Object.entries(expect.slotEquals ?? {})) {
    const actualValue = message.parsed?.slots[slot as keyof typeof message.parsed.slots];
    if (actualValue !== expectedValue) {
      failures.push(`slot.${slot}=${String(actualValue ?? 'missing')}`);
    }
  }
  for (const slot of expect.absentSlots ?? []) {
    const actualValue = message.parsed?.slots[slot as keyof NonNullable<typeof message.parsed>['slots']];
    if (actualValue !== undefined && actualValue !== null && actualValue !== '') {
      failures.push(`slot.${slot}=${String(actualValue)}`);
    }
  }

  return {
    name,
    ok: failures.length === 0,
    expected: JSON.stringify(expect),
    actual:
      failures.length === 0
        ? 'matched'
        : failures.join('; '),
  };
}

function assertPrivateSmokeMenuIsolation(): TelegramPrivateSmokeResult {
  const predictCallbacks = keyboardCallbacks(renderMenuSectionKeyboard('predict'));
  const strategyCallbacks = keyboardCallbacks(renderMenuSectionKeyboard('strategy'));
  const reportsCallbacks = keyboardCallbacks(renderMenuSectionKeyboard('reports'));
  const walletCallbacks = keyboardCallbacks(renderMenuSectionKeyboard('wallet'));
  const settingsCallbacks = keyboardCallbacks(renderMenuSectionKeyboard('settings'));

  const forbiddenPrefixes = ['sp:product:', 'sp:risk:', 'sp:match:', 'sp:confirm'];
  const forbiddenExact = new Set(['sp:status', 'sp:nl:products']);
  const allCallbacks = [
    ...predictCallbacks,
    ...strategyCallbacks,
    ...reportsCallbacks,
    ...walletCallbacks,
    ...settingsCallbacks,
  ];
  const violations = allCallbacks.filter(
    (callback) => forbiddenExact.has(callback) || forbiddenPrefixes.some((prefix) => callback.startsWith(prefix)),
  );

  const requiredPersonalCallbacks = [
    'sp:personal:pick_match',
    'sp:personal:next_open',
    'sp:personal:bundle',
    'sp:personal:podium',
    'sp:personal:advisory',
    'sp:personal:leaderboard',
  ];
  const missingPersonal = requiredPersonalCallbacks.filter((callback) => !predictCallbacks.includes(callback));
  const requiredSettingsCallbacks = ['sp:settings:tournament'];
  const missingSettings = requiredSettingsCallbacks.filter((callback) => !settingsCallbacks.includes(callback));

  const failures = [
    ...violations.map((callback) => `personal template exposes external-service callback ${callback}`),
    ...missingPersonal.map((callback) => `missing personal callback ${callback}`),
    ...missingSettings.map((callback) => `missing settings callback ${callback}`),
  ];

  return {
    name: 'menu isolation: personal-only callbacks',
    ok: failures.length === 0,
    expected: 'personal template exposes no external-service callbacks',
    actual: failures.length === 0 ? 'no external-service callbacks exposed' : failures.join('; '),
  };
}

function assertPrivateSmokeMenuCopy(
  tournament: Awaited<ReturnType<typeof listTournamentProfileOptions>>[number],
): TelegramPrivateSmokeResult {
  const predictText = renderMenuSectionText(tournament, 'predict').toLowerCase();
  const reportsText = renderMenuSectionText(tournament, 'reports').toLowerCase();
  const settingsText = renderMenuSectionText(tournament, 'settings').toLowerCase();
  const failures: string[] = [];

  if (!predictText.includes('do not collect third-party wallet details')) {
    failures.push('Predict copy does not state no third-party wallet collection.');
  }
  if (!predictText.includes('do not charge')) failures.push('Predict copy does not state no charge.');
  if (!predictText.includes('approve plan')) failures.push('Predict copy does not mention guarded Approve Plan.');
  if (!reportsText.includes('saved personal')) failures.push('Reports copy does not emphasize personal reports.');
  if (!settingsText.includes('change tournament')) failures.push('Settings copy does not mention Change Tournament.');
  if (!settingsText.includes('future buttons and natural-language requests')) {
    failures.push('Settings copy does not explain selected tournament routing.');
  }

  return {
    name: 'menu copy isolation: personal-only scopes are explicit',
    ok: failures.length === 0,
    expected: 'menu copy presents personal/free/read-only flows without external-service prompts',
    actual: failures.length === 0 ? 'menu copy is personal-only' : failures.join('; '),
  };
}

function assertPrivateSmokeFriendlyOutputHygiene(
  tournament: Awaited<ReturnType<typeof listTournamentProfileOptions>>[number],
  decision: DecisionReport,
): TelegramPrivateSmokeResult {
  const outputs = [
    renderMenuSectionText(tournament, 'predict'),
    renderMenuSectionText(tournament, 'reports'),
    renderFriendlyPredictionPreview(decision),
    renderFriendlyPersonalBundle([decision], {
      tournamentName: tournament.name,
      riskMode: decision.riskMode,
    }),
    renderFriendlySourceFallback({
      title: 'Live source unavailable',
      rawMessages: [
        'Indexer GraphQL error: prepared statement "abc" already exists',
        'Command failed: npm exec --yes --package=vara-wallet -- vara-wallet --json call 0xabc Service/QueryState',
      ],
      fallbackAction: 'Use a saved report if available, or rerun the analysis after the data source recovers.',
      nextRetry: '2026-06-05T18:00:00.000Z',
    }),
  ];
  const forbidden: Array<{ label: string; pattern: RegExp }> = [
    { label: 'npm command', pattern: /\bnpm run\b/i },
    { label: 'tsx command', pattern: /\btsx\b/i },
    { label: 'internal command tag', pattern: /\bcommand=decide\b/i },
    { label: 'SQLite warning', pattern: /\bSQLite\b/i },
    { label: 'prepared statement detail', pattern: /prepared statement/i },
    { label: 'raw command failure', pattern: /Command failed:/i },
    { label: 'raw vara-wallet call', pattern: /--json call/i },
    { label: 'stack trace', pattern: /\bstack trace\b/i },
    { label: 'node error prefix', pattern: /\bError:\s/i },
    { label: 'raw node internal path', pattern: /\bnode:/i },
    { label: 'planck-only EV wording', pattern: /\bplanck expected net value\b/i },
  ];
  const failures: string[] = [];
  for (const [index, output] of outputs.entries()) {
    for (const item of forbidden) {
      if (item.pattern.test(output)) failures.push(`output ${index + 1} contains ${item.label}`);
    }
  }

  return {
    name: 'friendly output hygiene: personal flows hide raw logs and internal errors',
    ok: failures.length === 0,
    expected: 'personal Telegram-facing renderers avoid raw commands, internal errors, and planck-only EV wording',
    actual: failures.length === 0 ? 'friendly outputs passed hygiene scan' : failures.join('; '),
  };
}

function assertPrivateSmokePredictionClosingAlerts(
  config: ReturnType<typeof loadConfig>,
  memory: MemoryStore,
  tournament: Awaited<ReturnType<typeof listTournamentProfileOptions>>[number],
): TelegramPrivateSmokeResult {
  const nowMs = Date.parse('2026-06-05T12:00:00.000Z');
  const plan = {
    generatedAt: new Date(nowMs).toISOString(),
    wallet: config.wallet.hexAddress,
    cutoff: {
      predictionCutoffMinutes: 10,
      safetyBufferMs: 15 * 60_000,
    },
    totalMatches: 1,
    eligibleMatches: [
      {
        matchId: '999',
        phase: 'Group Stage',
        phaseWeight: 1,
        home: 'Smoke Home',
        away: 'Smoke Away',
        kickOffMs: nowMs + 30 * 60_000,
        predictionCutoffMs: nowMs + 20 * 60_000,
        agentSafetyCloseMs: nowMs + 5 * 60_000,
        timeUntilSafetyCloseMs: 5 * 60_000,
        status: 'UNRESOLVED' as const,
        eligible: true,
        reasons: [],
      },
    ],
    ineligibleMatches: [],
  };
  const alertConfig = {
    ...config,
    telegram: {
      ...config.telegram,
      predictionAlertsEnabled: true,
      predictionAlertLeadMinutes: 30,
      predictionAlertScanMs: 60_000,
      predictionAlertChatIds: ['999999'],
    },
  };
  const first = buildDuePredictionClosingAlerts({
    config: alertConfig,
    memory,
    tournament,
    plan,
    nowMs,
  });
  for (const alert of first) memory.saveTelegramPredictionAlert(alert.record);
  const second = buildDuePredictionClosingAlerts({
    config: alertConfig,
    memory,
    tournament,
    plan,
    nowMs,
  });
  const text = first[0]?.text ?? '';
  const failures: string[] = [];
  if (first.length !== 1) failures.push(`expected 1 first alert, got ${first.length}`);
  if (second.length !== 0) failures.push(`expected 0 repeated alerts, got ${second.length}`);
  if (!text.includes('Prediction window alert')) failures.push('alert title missing');
  if (!text.includes('SmartCup closes predictions 10 minutes before kickoff')) {
    failures.push('cutoff explanation missing');
  }
  if (!text.includes('preview match 999')) failures.push('next action missing match id');
  for (const forbidden of [/npm run/i, /tsx/i, /SQLite/i, /prepared statement/i, /Command failed:/i, /stack trace/i]) {
    if (forbidden.test(text)) failures.push(`alert text contains forbidden marker ${forbidden}`);
  }

  return {
    name: 'prediction closing alerts: due match sends once with friendly copy',
    ok: failures.length === 0,
    expected: 'one due reminder, stored duplicate suppression, friendly alert text',
    actual: failures.length === 0 ? 'prediction alert planner passed' : failures.join('; '),
  };
}

function keyboardCallbacks(keyboard: ReturnType<typeof renderMenuSectionKeyboard>): string[] {
  return keyboard.inline_keyboard.flatMap((row) =>
    row
      .map((button) => ('callback_data' in button ? button.callback_data : null))
      .filter((value): value is string => Boolean(value)),
  );
}

function approvalDecisionHasLocalDuplicate(
  config: ReturnType<typeof loadConfig>,
  memory: MemoryStore,
  decisionId: string,
): boolean {
  const decision = memory.listDecisions().find((entry) => entry.id === decisionId);
  if (!decision) return false;
  return memory
    .listPredictions()
    .some(
      (prediction) =>
        prediction.walletAddress === config.wallet.hexAddress && String(prediction.matchId) === String(decision.matchId),
    );
}

function buildPrivateSmokeDecision(
  config: ReturnType<typeof loadConfig>,
  input: { id: string; matchId: string },
): DecisionReport {
  const generatedAt = new Date().toISOString();
  return {
    id: input.id,
    generatedAt,
    schemaVersion: 'smartpredictor.decision_report.v1',
    modelVersions: {
      forecast: 'private_smoke',
      crowding: 'private_smoke',
      payoutEv: 'private_smoke',
      pointsEv: 'private_smoke',
      simulation: 'private_smoke',
      opponentAware: 'private_smoke',
      risk: 'private_smoke',
      market: 'private_smoke',
      timing: 'private_smoke',
      sourceQuality: 'private_smoke',
    },
    wallet: {
      accountName: config.wallet.accountName,
      address: config.wallet.hexAddress,
      ss58: config.wallet.ss58Address,
    },
    matchId: input.matchId,
    match: {
      matchId: input.matchId,
      phase: 'Group Stage',
      home: 'Canada',
      away: 'Bosnia-Herzegovina',
      kickOffMs: Date.now() + 24 * 60 * 60 * 1000,
      status: 'UNRESOLVED',
    },
    tournament: {
      id: 'worldcup-2026-mvp',
      name: 'SmartCup League World Cup 2026 MVP',
      phase: 'Group Stage',
      phaseWeight: 1,
    },
    riskMode: 'balanced',
    selected: {
      score: { home: 2, away: 1 },
      outcome: 'home',
      penaltyWinner: null,
      utility: 0.5,
      confidence: 0.5,
    },
    probabilities: {
      exactScore: 0.08,
      home: 0.55,
      draw: 0.22,
      away: 0.23,
    },
    economics: {
      fundingSource: 'cash',
      roiBasis: 'cash_profit_over_stake',
      stakePlanck: '4500000000000000',
      userCapitalAtRiskPlanck: '4500000000000000',
      expectedRoi: null,
      expectedProfitPlanck: null,
      expectedNetValuePlanck: null,
      payoutIfExactPlanck: null,
      expectedWeightedPoints: 0.7,
      topFiveProbability: null,
      expectedFinalPrizeEquityPlanck: null,
      finalPrizeEquityDeltaPlanck: null,
      varaUsdPrice: {
        source: 'private_smoke',
        priceUsdMicro: '250000',
        updatedAt: generatedAt,
      },
    },
    sourceSnapshots: {
      chain: {
        finalPrizeAccumulatedPlanck: '0',
        protocolFeeAccumulatedPlanck: '0',
        userPoints: [],
        phaseCount: 0,
        r32LockTime: null,
        podiumFinalized: false,
        freebetLedgerProgramId: null,
      },
      pool: {},
      tournamentProfile: {
        profileId: 'worldcup-2026-mvp',
        name: 'SmartCup League World Cup 2026 MVP',
        scoring: {
          exactScorePoints: 10,
          correctOutcomePoints: 4,
        },
      },
      opponentSamples: {},
    },
    candidates: {
      risk: [],
      payoutEv: [],
      pointsEv: [],
      opponentAware: [],
    },
    sections: {},
    sourceWarnings: [
      'Indexer GraphQL error: prepared statement "abc" already exists',
      'Command failed: npm exec --yes --package=vara-wallet -- vara-wallet --json call 0xabc Service/QueryState',
    ],
    summary: {
      headline: 'Private smoke decision',
      recommendation: 'Canada 2-1 Bosnia-Herzegovina',
      confidenceLabel: 'medium',
      bullets: ['Private smoke fixture only.'],
    },
    rationale: ['Private smoke fixture only.'],
  } as unknown as DecisionReport;
}

function buildPrivateSmokePrediction(
  config: ReturnType<typeof loadConfig>,
  decision: DecisionReport,
): StoredPrediction {
  const createdAt = new Date().toISOString();
  return {
    id: `private-smoke-prediction-${decision.matchId}`,
    source: 'agent_execution',
    walletAddress: config.wallet.hexAddress,
    matchId: decision.matchId,
    score: decision.selected.score,
    penaltyWinner: decision.selected.penaltyWinner,
    predictedOutcome: decision.selected.outcome,
    amountPlanck: decision.economics.stakePlanck,
    matchPoolAmountPlanck: decision.economics.stakePlanck,
    createdAt,
    importedAt: createdAt,
    notes: 'Private Telegram smoke duplicate fixture.',
  };
}

function buildPrivateSmokePreference(input: {
  userId: string;
  tournamentId: string;
  role: StoredTelegramPreference['role'];
  patch: Parameters<typeof buildTelegramPreference>[0]['patch'];
}): StoredTelegramPreference {
  return buildTelegramPreference({
    telegramUserId: input.userId,
    tournamentId: input.tournamentId,
    role: input.role,
    ...(input.patch ? { patch: input.patch } : {}),
    updatedBy: 'smoke',
    note: 'Private Telegram smoke preference fixture.',
    payload: {
      harness: 'telegram-private-smoke',
    },
  });
}

function assertPrivateSmokePreference(
  memory: MemoryStore,
  expected: StoredTelegramPreference,
): TelegramPrivateSmokeResult {
  const actual = memory.getTelegramPreference({
    subjectId: expected.subjectId,
    tournamentId: expected.tournamentId,
    role: expected.role,
  });
  const ok =
    actual?.id === expected.id &&
    actual.defaultRiskMode === expected.defaultRiskMode &&
    actual.simulationObjective === expected.simulationObjective &&
    actual.strategyPosture === expected.strategyPosture &&
    actual.updatedBy === expected.updatedBy;

  return {
    name: `preference persistence: ${expected.role} ${expected.tournamentId}`,
    ok,
    expected: `risk=${expected.defaultRiskMode}, objective=${expected.simulationObjective}, posture=${expected.strategyPosture}`,
    actual: actual
      ? `risk=${actual.defaultRiskMode}, objective=${actual.simulationObjective}, posture=${actual.strategyPosture}`
      : 'missing',
  };
}

function assertPrivateSmokePreferenceApplied(input: {
  name: string;
  actual: string;
  expectedIncludes: string[];
}): TelegramPrivateSmokeResult {
  const missing = input.expectedIncludes.filter((part) => !input.actual.includes(part));
  return {
    name: input.name,
    ok: missing.length === 0,
    expected: input.expectedIncludes.join(', '),
    actual: missing.length === 0 ? input.actual : `${input.actual}; missing ${missing.join(', ')}`,
  };
}

function smokeOperatorCommand(intent: string): 'operator_decide' | 'operator_simulate' | 'operator_approve' | 'operator_policy' {
  if (intent === 'operator_policy') return 'operator_policy';
  if (intent === 'approve_plan') return 'operator_approve';
  if (intent === 'leaderboard_analysis') return 'operator_simulate';
  if (intent === 'market_analysis') return 'operator_decide';
  if (intent === 'timing_strategy') return 'operator_decide';
  if (intent === 'crowd_contrarian_map') return 'operator_decide';
  if (intent === 'football_context_risk') return 'operator_decide';
  if (intent === 'tournament_position_strategy') return 'operator_decide';
  if (intent === 'alternative_pick_set') return 'operator_decide';
  if (intent === 'saved_reports') return 'operator_decide';
  if (intent === 'personal_bundle') return 'operator_decide';
  if (intent === 'personal_podium_strategy') return 'operator_decide';
  if (intent === 'personal_tournament_advisory') return 'operator_simulate';
  if (intent === 'calibration_report') return 'operator_decide';
  if (intent === 'export_report') return 'operator_decide';
  return 'operator_decide';
}

function buildSmokeParserTelemetry(input: {
  text: string;
  chatId: string;
  userId: string;
  parsed: ReturnType<typeof parseTelegramNaturalLanguage>;
  actionTaken: ParserTelemetryActionTaken;
  safetyOutcome: ParserTelemetrySafetyOutcome;
  details: Record<string, unknown>;
}): StoredParserTelemetry {
  const createdAt = new Date().toISOString();
  return {
    id: `parser-telegram-smoke-${createdAt.replace(/[:.]/g, '-')}-${hashCliText(input.text).slice(2, 14)}`,
    createdAt,
    transport: 'telegram',
    rawTextHash: hashCliText(input.text),
    rawTextLength: input.text.length,
    chatHash: hashCliText(input.chatId),
    userHash: hashCliText(input.userId),
    parsedIntent: input.parsed.intent,
    parsedPermission: input.parsed.permission,
    parsedSafety: input.parsed.safety,
    slots: { ...input.parsed.slots },
    confidence: input.parsed.confidence,
    missingRequiredSlots: input.parsed.missingRequiredSlots,
    ambiguousSlots: input.parsed.ambiguousSlots,
    actionTaken: input.actionTaken,
    safetyOutcome: input.safetyOutcome,
    details: input.details,
  };
}

function hashCliText(value: string): `0x${string}` {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function parseSmokeTexts(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split('||')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRiskMode(value: string): RiskMode {
  if (
    value === 'conservative' ||
    value === 'balanced' ||
    value === 'contrarian' ||
    value === 'catch_up' ||
    value === 'protect_lead' ||
    value === 'final_swing'
  ) {
    return value;
  }
  throw new Error(`Invalid risk objective: ${value}`);
}

function parseFundingSource(value: string): FundingSource {
  if (value === 'cash' || value === 'freebet') return value;
  throw new Error(`Invalid funding source: ${value}`);
}

function parseExportFormat(value: string): 'markdown' | 'json' {
  if (value === 'markdown' || value === 'md') return 'markdown';
  if (value === 'json') return 'json';
  throw new Error(`Invalid export format: ${value}. Use markdown or json.`);
}

function parsePersonalSavedReportProduct(value: string): PersonalSavedReportProduct {
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'single' || normalized === 'single_match' || normalized === 'decision' || normalized === 'decision_report') {
    return 'single_match';
  }
  throw new Error(
    `Unsupported saved personal report product: ${value}. Current durable lookup supports single_match DecisionReports.`,
  );
}

function parseWizardFundingSource(value: string): FundingSource | 'auto' {
  if (value === 'auto' || value === 'cash' || value === 'freebet') return value;
  throw new Error(`Invalid onboarding funding source: ${value}. Use auto|cash|freebet.`);
}

function parseOptionalManualScore(args: Record<string, string>): Score | null {
  const homeRaw = args.scoreHome ?? args['score-home'];
  const awayRaw = args.scoreAway ?? args['score-away'];
  if (homeRaw === undefined && awayRaw === undefined) return null;
  if (homeRaw === undefined || awayRaw === undefined) {
    throw new Error('Manual score override requires both --score-home and --score-away.');
  }
  const home = Number(homeRaw);
  const away = Number(awayRaw);
  if (!Number.isSafeInteger(home) || !Number.isSafeInteger(away) || home < 0 || away < 0) {
    throw new Error('Manual score override must use non-negative integer goals.');
  }
  return { home, away };
}

function parseOptionalPenaltyWinner(args: Record<string, string>): PenaltyWinner | null {
  const raw = args.penaltyWinner ?? args['penalty-winner'];
  if (!raw || raw === 'none' || raw === 'null') return null;
  const normalized = raw.toLowerCase();
  if (normalized === 'home') return 'Home';
  if (normalized === 'away') return 'Away';
  throw new Error('Penalty winner must be home, away, none, or omitted.');
}

function parseTransactionKind(value: string): TransactionKind {
  if (
    value === 'PlaceBet' ||
    value === 'SpendFreebet' ||
    value === 'SubmitPodiumPick' ||
    value === 'ClaimMatchReward' ||
    value === 'ClaimRefund' ||
    value === 'ClaimFinalPrize'
  ) {
    return value;
  }
  throw new Error(
    'submit requires --kind PlaceBet|SpendFreebet|SubmitPodiumPick|ClaimMatchReward|ClaimRefund|ClaimFinalPrize, or --decision for a saved bet decision.',
  );
}

function requiredArg(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value || value === 'true') throw new Error(`Missing required --${name}.`);
  return value;
}

function optionalArg(args: Record<string, string>, name: string): string | undefined {
  const value = args[name];
  if (!value || value === 'true') return undefined;
  return value;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive number: ${value}`);
  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatPayoutEvBullet(
  expectedRoi: number,
  expectedNetValuePlanck: string,
  price: VaraUsdPriceSource | null,
): string {
  const roiPercent = `${roundForDisplay(expectedRoi * 100)}%`;
  const vara = `${planckToVaraString(expectedNetValuePlanck)} VARA`;
  if (!price) {
    return `Cash payout EV: ${roiPercent} ROI; expected net ${vara}. USD conversion unavailable because VARA/USD price is missing.`;
  }
  return `Cash payout EV: ${roiPercent} ROI; expected net ${vara} (~${formatUsdAmount(planckToUsdString(expectedNetValuePlanck, price))} USD at ${formatVaraUsdPrice(price)}).`;
}

function varaUsdPriceFromState(state: IoSmartCupState): VaraUsdPriceSource | null {
  const priceUsdMicro = BigInt(state.vara_price_usd_micro || '0');
  if (priceUsdMicro <= 0n) return null;
  return {
    source: 'bolao_state',
    priceUsdMicro,
    updatedAt: state.price_cached_at,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
