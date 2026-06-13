import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import {
  formatUsdAmount,
  formatVaraUsdPrice,
  planckToUsdString,
  planckToVaraString,
  readVaraUsdPrice,
  type VaraUsdPriceSource,
} from '../economics/vara-usd-converter.js';
import { ManualFootballContextAdapter } from '../adapters/manual-football-context-adapter.js';
import { ManualOddsAdapter } from '../adapters/manual-odds-adapter.js';
import { OpponentFeatureAdapter } from '../adapters/opponent-feature-adapter.js';
import { PoolDistributionAdapter } from '../adapters/pool-distribution-adapter.js';
import {
  AlternativePickSetModel,
  ConfidenceDegradationModel,
  CrowdModel,
  CrowdContrarianMapModel,
  ForecastModel,
  FootballContextRiskModel,
  MarketComparisonModel,
  MonteCarloLeaderboardModel,
  OpponentAwareOutputModel,
  OpponentSamplerModel,
  PayoutEvModel,
  PointsEvModel,
  RiskModeModel,
  SourceQualityModel,
  TimingStrategyModel,
  TournamentPositionStrategyModel,
} from '../models/index.js';
import { loadTournamentProfile, reconcileTournamentProfileWithChain } from '../tournament/index.js';
import type { ScoreMatrixForecast } from '../models/forecast-model.js';
import type {
  AgentConfig,
  AlternativePickSetReport,
  BolaoMatch,
  CandidatePayoutEvReport,
  CandidatePointsEvReport,
  ConfidenceDegradationReport,
  CrowdContrarianMapReport,
  DecisionReport,
  FootballContextProviderBatch,
  FootballContextRiskReport,
  FundingSource,
  IoSmartCupState,
  MatchPoolDistributionView,
  MarketOddsComparisonReport,
  MonteCarloLeaderboardSimulationReport,
  NormalizedOddsSnapshot,
  OpponentAwareOutputReport,
  OpponentFeatureImportReport,
  OpponentPredictionSamplerReport,
  PenaltyWinner,
  PoolOutcome,
  RiskMode,
  RiskModeEvaluationReport,
  Score,
  SmartCupMatch,
  SourceQualityReport,
  TimingStrategyReport,
  TournamentPositionStrategyReport,
  TournamentProfile,
} from '../types/index.js';

export type DecisionWorkflowOptions = {
  riskMode: RiskMode;
  fundingSource: FundingSource;
  stakePlanck: string;
  seed: string;
  opponentLimit: number;
  profileLimit: number;
  topScores: number;
  iterations: number;
  candidateLimit: number;
};

export async function buildDecisionForMatch(
  config: AgentConfig,
  matchId: string,
  options: DecisionWorkflowOptions,
): Promise<DecisionReport> {
  const result = await buildSimulationInputs(config, matchId, {
    seed: options.seed,
    opponentLimit: options.opponentLimit,
    profileLimit: options.profileLimit,
    topScores: options.topScores,
  });

  const simulation = new MonteCarloLeaderboardModel({
    iterations: Number.isFinite(options.iterations) ? options.iterations : 2000,
    seed: options.seed,
    candidateLimit: options.candidateLimit,
  }).simulateCandidateScores({
    forecast: result.forecast,
    pointsEv: result.pointsEv,
    opponentSamples: result.opponentSamples.samples,
    state: result.state,
    profile: result.profile,
    wallet: config.wallet.hexAddress,
  });

  const opponentAware = new OpponentAwareOutputModel().buildReport(simulation, options.riskMode);
  const payoutEv = new PayoutEvModel().computeCandidatePayoutEv(
    result.forecast,
    result.crowding,
    options.stakePlanck,
    options.fundingSource,
  );
  const risk = new RiskModeModel().evaluate({
    riskMode: options.riskMode,
    fundingSource: options.fundingSource,
    payoutEv,
    pointsEv: result.pointsEv,
    crowding: result.crowding,
    opponentAware,
  });
  const varaUsdPrice = await readVaraUsdPrice(config).catch(() => null);

  return buildDecisionReport({
    config,
    match: result.match,
    profile: result.profile,
    forecast: result.forecast,
    pool: result.pool,
    crowding: result.crowding,
    payoutEv,
    pointsEv: result.pointsEv,
    simulation,
    opponentAware,
    risk,
    fundingSource: options.fundingSource,
    stakePlanck: options.stakePlanck,
    sourceWarnings: result.opponents.warnings,
    candidateLimit: options.candidateLimit,
    state: result.state,
    opponents: result.opponents,
    opponentSamples: result.opponentSamples,
    odds: result.odds,
    footballContext: result.footballContext,
    varaUsdPrice,
  });
}

async function buildSimulationInputs(
  config: AgentConfig,
  matchId: string,
  options: {
    seed: string;
    opponentLimit: number;
    profileLimit: number;
    topScores: number;
  },
) {
  const chain = new BolaoChainClient(config);
  const match = await chain.queryMatch(matchId);
  const state = await chain.queryState();
  const profile = await loadTournamentProfile(config.artifacts.tournamentProfilePath);
  if (!match) throw new Error(`Match not found: ${matchId}`);

  const smartCupMatch = toSmartCupMatch(match);
  const reconciledProfile = reconcileTournamentProfileWithChain(profile, state);
  const pool = await new PoolDistributionAdapter(config).getMatchPool(matchId);
  const crowding = new CrowdModel().estimateExactScoreCrowding(pool);
  const forecast = new ForecastModel().forecastScoreMatrix(smartCupMatch);
  const pointsEv = new PointsEvModel().computeCandidatePointsEv(smartCupMatch, forecast, reconciledProfile);
  const opponents = await new OpponentFeatureAdapter(config).importProfiles({ limit: options.opponentLimit });
  const odds = await new ManualOddsAdapter(config.services.manualOddsJson).fetch(
    {
      tournamentId: reconciledProfile.tournamentId,
      matchId,
      homeTeam: smartCupMatch.home,
      awayTeam: smartCupMatch.away,
      markets: ['match_winner', 'exact_score'],
    },
    {
      tournamentId: reconciledProfile.tournamentId,
      matchId,
      homeTeam: smartCupMatch.home,
      awayTeam: smartCupMatch.away,
      kickoffAt: new Date(smartCupMatch.kickOffMs).toISOString(),
    },
  );
  const footballContext = await new ManualFootballContextAdapter(config.services.manualFootballContextJson).fetchContext(
    {
      tournamentId: reconciledProfile.tournamentId,
      matchId,
      teams: [smartCupMatch.home, smartCupMatch.away],
      kickoffAt: new Date(smartCupMatch.kickOffMs).toISOString(),
    },
    {
      tournamentId: reconciledProfile.tournamentId,
      matchId,
      homeTeam: smartCupMatch.home,
      awayTeam: smartCupMatch.away,
      kickoffAt: new Date(smartCupMatch.kickOffMs).toISOString(),
    },
  );
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
    odds,
    footballContext,
    opponentSamples,
  };
}

function buildDecisionReport(params: {
  config: AgentConfig;
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
  odds: {
    provider: string;
    records: NormalizedOddsSnapshot[];
    warnings?: string[];
  };
  footballContext: FootballContextProviderBatch;
  varaUsdPrice: VaraUsdPriceSource | null;
  fundingSource: FundingSource;
  stakePlanck: string;
  sourceWarnings: string[];
  candidateLimit: number;
  state: IoSmartCupState;
  opponents: OpponentFeatureImportReport;
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
  const baseConfidence = confidenceFrom(selected.utility, selectedForecast?.probability ?? selected.components.forecast);
  const baseConfidenceLabel = confidenceLabelFor(baseConfidence);
  const varaUsdPrice = params.varaUsdPrice ?? varaUsdPriceFromState(params.state);
  const generatedAt = new Date().toISOString();
  const recommendation = `${params.match.home} ${selected.score.home}-${selected.score.away} ${params.match.away}`;
  const headline = `${recommendation} under ${params.risk.riskMode} mode`;
  const topLimit = Number.isFinite(params.candidateLimit) && params.candidateLimit > 0 ? params.candidateLimit : 12;
  const marketComparison = buildMarketComparison(
    params,
    selected.score,
    selected.outcome,
    selectedForecast?.probability ?? selected.components.forecast,
  );
  const timingStrategy = buildTimingStrategy(params, marketComparison, baseConfidence);
  const crowdContrarianMap = buildCrowdContrarianMap(params, selected.score, selected.outcome);
  const footballContextRisk = buildFootballContextRisk(params);
  const tournamentPositionStrategy = buildTournamentPositionStrategy(params, selected.score, selected.outcome, baseConfidence);
  const alternativePickSet = buildAlternativePickSet(params);
  const preDegradationWarnings = [
    ...params.sourceWarnings,
    ...marketComparison.warnings,
    ...timingStrategy.warnings,
    ...crowdContrarianMap.warnings,
    ...footballContextRisk.warnings,
    ...tournamentPositionStrategy.warnings,
    ...alternativePickSet.warnings,
  ];
  const confidenceDegradation = buildConfidenceDegradation({
    matchId: params.match.matchId,
    originalConfidence: baseConfidence,
    originalLabel: baseConfidenceLabel,
    sourceWarnings: preDegradationWarnings,
    marketComparison,
    timingStrategy,
    crowding: params.crowding,
    crowdContrarianMap,
    footballContextRisk,
    tournamentPositionStrategy,
    opponentAware: params.opponentAware,
  });
  const sourceQuality = buildSourceQuality(params.match.matchId, confidenceDegradation);
  const confidence = confidenceDegradation.adjustedConfidence;
  const confidenceLabel = confidenceDegradation.adjustedLabel;
  const sourceWarnings = [
    ...preDegradationWarnings,
    ...confidenceDegradation.warnings,
    ...sourceQuality.degradedReadWarnings.map((warning) => `Source quality: ${warning}`),
  ];

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
      odds: params.odds.records,
      footballContext: {
        lineups: params.footballContext.lineups,
        availability: params.footballContext.availability,
        news: params.footballContext.news,
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
    sourceWarnings,
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
        marketComparison.selected.outcomeComparison
          ? `Market edge ${roundForDisplay((marketComparison.selected.outcomeComparison.edge ?? 0) * 100)} percentage points for selected outcome versus normalized bookmaker probability.`
          : marketComparison.summary,
        `Timing strategy: ${formatTimingRecommendation(timingStrategy.recommendation)} (${timingStrategy.confidence} confidence); safety close at ${timingStrategy.agentSafetyCloseAt}.`,
        `Crowd map: ${crowdContrarianMap.summary}`,
        `Football context: ${footballContextRisk.summary}`,
        `Tournament position: ${tournamentPositionStrategy.recommendation}`,
        `Alternative picks: ${alternativePickSet.summary}`,
        `Confidence quality: ${confidenceDegradation.summary}`,
        `Source quality: ${sourceQuality.summary}`,
      ],
    },
    rationale: [
      ...selected.rationale,
      ...timingStrategy.rationale.map((line) => `Timing: ${line}`),
      ...(crowdContrarianMap.selectedScoreOpportunity?.rationale ?? []).map((line) => `Crowd: ${line}`),
      ...footballContextRisk.signals.map((signal) => `Context: ${signal.label}: ${signal.detail}`),
      ...tournamentPositionStrategy.rationale.map((line) => `Position: ${line}`),
      ...alternativePickSet.picks.flatMap((pick) => pick.rationale.map((line) => `Alternative ${pick.kind}: ${line}`)),
      ...confidenceDegradation.sourceFactors
        .filter((factor) => factor.status !== 'healthy')
        .map((factor) => `Confidence: ${factor.label} ${factor.status}; penalty ${factor.penalty}. ${factor.detail}`),
      ...sourceQuality.degradedReadWarnings.map((warning) => `Source quality: ${warning}`),
      ...(sourceQuality.suggestedRetryAt
        ? [`Source quality retry: ${sourceQuality.retryReason ?? 'Refresh source reads before approval.'} Suggested retry at ${sourceQuality.suggestedRetryAt}.`]
        : []),
    ],
  };
}

function buildSourceQuality(
  matchId: string,
  confidenceDegradation: ConfidenceDegradationReport,
): SourceQualityReport {
  return new SourceQualityModel().buildReport({
    matchId,
    confidenceDegradation,
  });
}

function buildConfidenceDegradation(params: {
  matchId: string;
  originalConfidence: number;
  originalLabel: 'low' | 'medium' | 'high';
  sourceWarnings: string[];
  marketComparison: MarketOddsComparisonReport;
  timingStrategy: TimingStrategyReport;
  crowding: ReturnType<CrowdModel['estimateExactScoreCrowding']>;
  crowdContrarianMap: CrowdContrarianMapReport;
  footballContextRisk: FootballContextRiskReport;
  tournamentPositionStrategy: TournamentPositionStrategyReport;
  opponentAware: OpponentAwareOutputReport;
}): ConfidenceDegradationReport {
  return new ConfidenceDegradationModel().buildReport(params);
}

function buildAlternativePickSet(params: {
  match: SmartCupMatch;
  risk: RiskModeEvaluationReport;
  payoutEv: CandidatePayoutEvReport;
  pointsEv: CandidatePointsEvReport;
  opponentAware: OpponentAwareOutputReport;
}): AlternativePickSetReport {
  return new AlternativePickSetModel().buildReport({
    matchId: params.match.matchId,
    risk: params.risk,
    payoutEv: params.payoutEv,
    pointsEv: params.pointsEv,
    opponentAware: params.opponentAware,
  });
}

function buildMarketComparison(
  params: {
    match: SmartCupMatch;
    forecast: ScoreMatrixForecast;
    odds: {
      provider: string;
      records: NormalizedOddsSnapshot[];
      warnings?: string[];
    };
  },
  selectedScore: Score,
  selectedOutcome: PoolOutcome,
  exactScoreProbability: number,
): MarketOddsComparisonReport {
  return new MarketComparisonModel().buildReport({
    matchId: params.match.matchId,
    selectedScore,
    selectedOutcome,
    probabilities: {
      exactScore: exactScoreProbability,
      home: params.forecast.outcomeProbabilities.home,
      draw: params.forecast.outcomeProbabilities.draw,
      away: params.forecast.outcomeProbabilities.away,
    },
    provider: params.odds.provider,
    providerConfigured: params.odds.records.length > 0 || !(params.odds.warnings ?? []).some((warning) => warning.includes('not configured')),
    snapshots: params.odds.records,
    warnings: params.odds.warnings ?? [],
  });
}

function buildTimingStrategy(
  params: {
    match: SmartCupMatch;
    pointsEv: CandidatePointsEvReport;
    profile: TournamentProfile;
    sourceWarnings: string[];
  },
  marketComparison: MarketOddsComparisonReport,
  selectedConfidence: number,
): TimingStrategyReport {
  return new TimingStrategyModel().buildReport({
    matchId: params.match.matchId,
    kickOffMs: params.match.kickOffMs,
    phaseWeight: params.pointsEv.phaseWeight,
    cutoff: params.profile.cutoff,
    sourceWarnings: [...params.sourceWarnings, ...marketComparison.warnings],
    marketComparison,
    selectedConfidence,
  });
}

function buildCrowdContrarianMap(
  params: {
    match: SmartCupMatch;
    forecast: ScoreMatrixForecast;
    crowding: ReturnType<CrowdModel['estimateExactScoreCrowding']>;
  },
  selectedScore: Score,
  selectedOutcome: PoolOutcome,
): CrowdContrarianMapReport {
  return new CrowdContrarianMapModel().buildReport({
    matchId: params.match.matchId,
    forecast: params.forecast,
    crowding: params.crowding,
    selectedScore,
    selectedOutcome,
  });
}

function buildFootballContextRisk(params: {
  match: SmartCupMatch;
  footballContext: FootballContextProviderBatch;
}): FootballContextRiskReport {
  return new FootballContextRiskModel().buildReport({
    match: params.match,
    providerConfigured:
      params.footballContext.lineups.length > 0 ||
      params.footballContext.availability.length > 0 ||
      params.footballContext.news.length > 0 ||
      !params.footballContext.warnings.some((warning) => warning.includes('not configured')),
    context: params.footballContext,
  });
}

function buildTournamentPositionStrategy(
  params: {
    match: SmartCupMatch;
    risk: RiskModeEvaluationReport;
    state: IoSmartCupState;
    opponents: OpponentFeatureImportReport;
    config: AgentConfig;
    pointsEv: CandidatePointsEvReport;
  },
  selectedScore: Score,
  selectedOutcome: PoolOutcome,
  selectedConfidence: number,
): TournamentPositionStrategyReport {
  return new TournamentPositionStrategyModel().buildReport({
    matchId: params.match.matchId,
    wallet: params.config.wallet.hexAddress,
    state: params.state,
    opponentProfiles: params.opponents.profiles,
    phase: params.match.phase,
    phaseWeight: params.pointsEv.phaseWeight,
    selectedScore,
    selectedOutcome,
    selectedConfidence,
    risk: params.risk,
  });
}

function formatTimingRecommendation(recommendation: TimingStrategyReport['recommendation']): string {
  if (recommendation === 'predict_now') return 'predict now';
  if (recommendation === 'wait') return 'wait and refresh';
  return 'blocked by cutoff';
}

function toSmartCupMatch(match: BolaoMatch): SmartCupMatch {
  return {
    matchId: match.match_id,
    phase: match.phase,
    home: match.home,
    away: match.away,
    kickOffMs: Number(match.kick_off),
    status:
      match.result.kind === 'Cancelled'
        ? 'CANCELLED'
        : match.settlement_prepared
          ? 'SETTLED'
          : match.result.kind === 'Finalized'
            ? 'FINALIZED'
            : match.result.kind === 'Proposed'
              ? 'PROPOSED'
              : 'UNRESOLVED',
  };
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

function confidenceLabelFor(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence < 0.45) return 'low';
  if (confidence < 0.7) return 'medium';
  return 'high';
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

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function roundForDisplay(value: number): number {
  return Number(value.toFixed(6));
}
