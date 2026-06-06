export type HexAddress = `0x${string}`;
export type ActorId = HexAddress;
export type U64String = string;
export type U128String = string;

export type RiskMode =
  | 'conservative'
  | 'balanced'
  | 'contrarian'
  | 'catch_up'
  | 'protect_lead'
  | 'final_swing';

export type ExecutionMode = 'read_only' | 'approval_required' | 'tournament_autopilot' | 'claim_only';
export type FundingSource = 'cash' | 'freebet';

export type TelegramMode = 'polling' | 'webhook';

export type AgentConfig = {
  agent: {
    handle: string;
    name: string;
  };
  wallet: {
    accountName: string;
    hexAddress: HexAddress;
    ss58Address: string;
  };
  network: {
    name: 'mainnet' | 'testnet' | 'local';
    rpcUrl: string;
  };
  programs: {
    bolaoCore: HexAddress;
    oracle: HexAddress;
    freebetLedger: HexAddress | null;
  };
  services: {
    fixtureProvider: 'football-data.org';
    oddsProvider: 'manual';
    footballContextProvider: 'manual';
    smartcupApiUrl: string;
    indexerGraphqlUrl: string;
    indexerGraphqlTimeoutMs: number;
    footballDataBaseUrl: string;
    footballDataApiToken: string | null;
    manualOddsJson: string | null;
    manualFootballContextJson: string | null;
  };
  artifacts: {
    bolaoIdlPath: string;
    freebetLedgerIdlPath: string;
    oracleIdlPath: string;
    tournamentProfilePath: string;
  };
  economics: {
    matchWinnerPoolBps: number;
    finalPrizePoolBps: number;
    protocolFeeBps: number;
  };
  policy: {
    mode: ExecutionMode;
    cutoffBufferMs: number;
    minStakeUsd: string | null;
    maxStakePlanck: string;
    maxTournamentExposurePlanck: string;
    maxStakeUsd: string | null;
    maxTournamentExposureUsd: string | null;
    approvalFlowVerified: boolean;
    liveSmokeVerified: boolean;
    liveSmokeReference: string | null;
  };
  telegram: {
    botToken: string | null;
    adminIds: string[];
    mode: TelegramMode;
    webhookUrl: string | null;
    webhookHost: string;
    webhookPort: number;
    webhookSecret: string | null;
    publicBotName: string;
    predictionAlertsEnabled: boolean;
    predictionAlertLeadMinutes: number;
    predictionAlertScanMs: number;
    predictionAlertChatIds: string[];
  };
};

export type TournamentProfileSchemaVersion = 'smartpredictor.tournament-profile.v1';

export type TournamentPhaseKey =
  | 'group'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'final'
  | 'custom';

export type TournamentPhaseProfile = {
  key: TournamentPhaseKey;
  name: string;
  smartcupPhaseNames: string[];
  pointsWeight: number;
  weightSource?: 'contract' | 'published_rules' | 'operator_config' | 'planned';
  description?: string;
  startsAt: string | null;
  endsAt: string | null;
  matchIdRange: {
    first: string | null;
    last: string | null;
  } | null;
};

export type TournamentCutoffPolicy = {
  predictionCutoffMinutes: number;
  safetyBufferMs: number;
};

export type TournamentRewardSplit = {
  matchWinnerPoolBps: number;
  finalPrizePoolBps: number;
  protocolFeeBps: number;
};

export type TournamentEntryPolicy = {
  minimumEntryUsd: number;
  minimumEntrySource: 'dynamic_usd_to_vara' | 'fixed_planck' | 'operator_config';
};

export type TournamentScoringPolicy = {
  exactScorePoints: number;
  correctOutcomePoints: number;
  incorrectPoints: number;
  phaseWeightsApply: boolean;
};

export type TournamentClaimPolicy = {
  matchRewardClaimWindowHours: number;
};

export type FinalPrizeDistributionEntry = {
  place: number;
  bps: number;
};

export type TournamentFinalPrizePolicy = {
  placesPaid: number;
  distribution: FinalPrizeDistributionEntry[];
  tieBreak: 'combine_and_split_tied_positions';
};

export type ChampionshipPickBonusPolicy = {
  championPoints: number;
  runnerUpPoints: number;
  thirdPlacePoints: number;
  exactPositionOnly: boolean;
};

export type TournamentProgramProfile = {
  bolaoCore: HexAddress;
  oracle: HexAddress;
  freebetLedger?: HexAddress | null;
};

export type TournamentProviderProfile = {
  fixtures: 'football-data.org';
  odds?: string[];
  news?: string[];
  injuries?: string[];
};

export type PodiumPickWindowProfile = {
  enabled: boolean;
  phaseKey: TournamentPhaseKey;
  targetMatchId: string | null;
  targetMatchLabel: string;
  expectedMatchupDefinedAt: string | null;
  kickoffAt: string | null;
  lockSource?: 'contract_r32_lock_time' | 'published_rules' | 'operator_config';
  opportunityWindowHours: {
    min: number;
    max: number;
  } | null;
  bonusPoints?: ChampionshipPickBonusPolicy;
};

export type TournamentProfile = {
  schemaVersion: TournamentProfileSchemaVersion;
  tournamentId: string;
  slug: string;
  name: string;
  season: string;
  timezone: string;
  matchCount: number | null;
  defaultRiskMode: RiskMode;
  programs: TournamentProgramProfile;
  providers: TournamentProviderProfile;
  cutoff: TournamentCutoffPolicy;
  entry: TournamentEntryPolicy;
  scoring: TournamentScoringPolicy;
  claims: TournamentClaimPolicy;
  rewardSplit: TournamentRewardSplit;
  finalPrize: TournamentFinalPrizePolicy;
  phases: TournamentPhaseProfile[];
  podiumPick: PodiumPickWindowProfile | null;
  notes?: string[];
};

export type FreebetGrant = {
  id: string;
  recipient: ActorId;
  amount: U128String;
  reason: string;
  granted_at: U64String;
};

export type OracleResultStatus = 'Pending' | 'Finalized';

export type OracleFinalResult = {
  score: Score;
  penalty_winner: PenaltyWinner | null;
  finalized_at: U64String;
};

export type IoOracleMatchResult = {
  match_id: U64String;
  phase: string;
  home: string;
  away: string;
  kick_off: U64String;
  status: OracleResultStatus;
  final_result: OracleFinalResult | null;
  submissions: number;
};

export type IoOracleState = {
  admin: ActorId;
  admins: ActorId[];
  operators: ActorId[];
  consensus_threshold: number;
  bolao_program_id: ActorId | null;
  authorized_feeders: ActorId[];
  match_results: IoOracleMatchResult[];
  pending_admin: ActorId | null;
  vara_price_usd_micro: U64String;
  price_updated_at: U64String;
};

export type OracleFeederSubmission = {
  match_id: U64String;
  score: Score;
  penalty_winner: PenaltyWinner | null;
};

export type OracleVaraUsdPrice = {
  price_usd_micro: U64String;
  price_updated_at: U64String;
};

export type TeamRatingSource = 'operator_seed' | 'provider' | 'result_update' | 'default';

export type TeamRating = {
  team: string;
  rating: number;
  source: TeamRatingSource;
  updatedAt: string;
  sampleSize: number;
  aliases?: string[];
};

export type TeamRatingView = {
  team: string;
  canonicalTeam: string;
  rating: number;
  source: TeamRatingSource;
  sampleSize: number;
  isDefault: boolean;
};

export type MatchRatingView = {
  home: TeamRatingView;
  away: TeamRatingView;
  homeAdvantage: number;
  adjustedHomeRating: number;
  adjustedAwayRating: number;
  ratingDiff: number;
  expectedHomeResult: number;
  expectedAwayResult: number;
  confidence: number;
};

export type ProviderCapability = 'fixtures' | 'results' | 'odds' | 'news' | 'injuries' | 'lineups' | 'football_context';

export type ProviderDescriptor = {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  baseUrl?: string;
  requiresApiToken: boolean;
  notes?: string[];
};

export type ProviderHealthStatus = 'configured' | 'missing_credentials' | 'unavailable' | 'unknown';

export type ProviderHealth = {
  providerId: string;
  status: ProviderHealthStatus;
  checkedAt: string;
  message?: string;
};

export type ProviderRequestContext = {
  tournamentId?: string;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffAt?: string;
  generatedAt?: string;
};

export type ProviderBatch<TRecord> = {
  provider: string;
  capability: ProviderCapability;
  fetchedAt: string;
  records: TRecord[];
  warnings?: string[];
};

export interface AgentDataProvider<TRecord, TQuery = Record<string, never>> {
  readonly descriptor: ProviderDescriptor;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  fetch(query: TQuery, context?: ProviderRequestContext): Promise<ProviderBatch<TRecord>>;
}

export type ProviderMatchStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'FINISHED'
  | 'POSTPONED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'UNKNOWN';

export type NormalizedFootballTeam = {
  provider: 'football-data.org';
  id: string | null;
  name: string;
  shortName: string | null;
  tla: string | null;
};

export type NormalizedFootballMatch = {
  provider: 'football-data.org';
  providerMatchId: string;
  competitionCode: string | null;
  competitionName: string | null;
  seasonStartYear: number | null;
  utcDate: string;
  status: ProviderMatchStatus;
  stage: string | null;
  matchday: number | null;
  group: string | null;
  homeTeam: NormalizedFootballTeam;
  awayTeam: NormalizedFootballTeam;
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: string | null;
    fullTime: Score | null;
    regularTime: Score | null;
    extraTime: Score | null;
    penalties: Score | null;
  };
  lastUpdated: string | null;
};

export interface FixtureResultProvider extends AgentDataProvider<NormalizedFootballMatch, FootballDataFixtureQuery> {
  listCompetitionMatches(query?: FootballDataFixtureQuery): Promise<NormalizedFootballMatch[]>;
  listTeamMatches(teamId: string | number, query?: FootballDataFixtureQuery): Promise<NormalizedFootballMatch[]>;
  getMatch(matchId: string | number): Promise<NormalizedFootballMatch>;
}

export type FootballDataFixtureQuery = {
  competition?: string;
  season?: number;
  dateFrom?: string;
  dateTo?: string;
  status?: ProviderMatchStatus;
  matchday?: number;
};

export type OddsMarketType =
  | 'match_winner'
  | 'exact_score'
  | 'double_chance'
  | 'total_goals'
  | 'both_teams_to_score'
  | 'champion'
  | 'podium';

export type OddsSelectionOutcome =
  | 'home'
  | 'draw'
  | 'away'
  | 'home_or_draw'
  | 'away_or_draw'
  | 'home_or_away'
  | 'over'
  | 'under'
  | 'exact_score'
  | 'team';

export type NormalizedOddsSelection = {
  label: string;
  outcome: OddsSelectionOutcome;
  priceDecimal: number;
  impliedProbability: number | null;
  line: number | null;
  score: Score | null;
  team: string | null;
  bookmaker: string | null;
};

export type NormalizedOddsSnapshot = {
  provider: string;
  providerEventId: string | null;
  matchId: string | null;
  market: OddsMarketType;
  observedAt: string;
  selections: NormalizedOddsSelection[];
  sourceUrl: string | null;
  confidence: number;
};

export type OddsProviderQuery = {
  tournamentId?: string;
  matchId?: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffFrom?: string;
  kickoffTo?: string;
  markets?: OddsMarketType[];
};

export interface OddsProvider extends AgentDataProvider<NormalizedOddsSnapshot, OddsProviderQuery> {}

export type MarketComparisonEdgeDirection = 'positive' | 'neutral' | 'negative' | 'unavailable';

export type MarketComparisonProbability = {
  agentProbability: number;
  marketImpliedProbability: number | null;
  marketNormalizedProbability: number | null;
  edge: number | null;
  edgeDirection: MarketComparisonEdgeDirection;
  bookmaker: string | null;
  priceDecimal: number | null;
};

export type MarketOddsComparisonReport = {
  matchId: string;
  generatedAt: string;
  model: 'market_odds_comparison_v1';
  provider: string;
  providerConfigured: boolean;
  observedAt: string | null;
  markets: {
    matchWinner: {
      overround: number | null;
      home: MarketComparisonProbability;
      draw: MarketComparisonProbability;
      away: MarketComparisonProbability;
    } | null;
    exactScore: MarketComparisonProbability | null;
  };
  selected: {
    outcome: PoolOutcome;
    score: Score;
    outcomeComparison: MarketComparisonProbability | null;
    exactScoreComparison: MarketComparisonProbability | null;
  };
  summary: string;
  warnings: string[];
  snapshots: NormalizedOddsSnapshot[];
};

export type TimingStrategyRecommendation = 'predict_now' | 'wait' | 'blocked_by_cutoff';

export type TimingStrategySignal = {
  key:
    | 'cutoff_window'
    | 'kickoff_distance'
    | 'source_quality'
    | 'market_availability'
    | 'phase_weight'
    | 'confidence'
    | 'crowd_information';
  label: string;
  direction: 'predict_now' | 'wait' | 'blocked' | 'neutral';
  severity: 'low' | 'medium' | 'high';
  detail: string;
};

export type TimingStrategyReport = {
  matchId: string;
  generatedAt: string;
  model: 'timing_strategy_v1';
  recommendation: TimingStrategyRecommendation;
  confidence: 'low' | 'medium' | 'high';
  currentTime: string;
  kickoffAt: string;
  predictionCutoffAt: string;
  agentSafetyCloseAt: string;
  minutesUntilKickoff: number;
  minutesUntilPredictionCutoff: number;
  minutesUntilAgentSafetyClose: number;
  dataVolatility: 'low' | 'medium' | 'high';
  sourceQuality: 'degraded' | 'partial' | 'healthy';
  rationale: string[];
  signals: TimingStrategySignal[];
  nextReviewAt: string | null;
  warnings: string[];
};

export type NewsImpactDirection = 'positive' | 'negative' | 'neutral' | 'unknown';
export type ProviderFreshnessLabel = 'fresh' | 'usable' | 'stale' | 'missing' | 'unknown';
export type ProviderUncertaintyLabel = 'low' | 'medium' | 'high' | 'unknown';

export type LineupStatus = 'confirmed' | 'probable' | 'projected' | 'unknown';

export type LineupPlayerRole = 'starter' | 'bench' | 'absent' | 'unknown';

export type NormalizedLineupPlayer = {
  player: string;
  position: string | null;
  role: LineupPlayerRole;
  confidence: number;
};

export type NormalizedLineupSnapshot = {
  provider: string;
  matchId: string | null;
  team: string;
  status: LineupStatus;
  formation: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  confidence: number;
  players: NormalizedLineupPlayer[];
};

export type LineupProviderQuery = {
  tournamentId?: string;
  matchId?: string;
  teams?: string[];
  updatedFrom?: string;
  updatedTo?: string;
};

export interface LineupProvider extends AgentDataProvider<NormalizedLineupSnapshot, LineupProviderQuery> {}

export type NormalizedNewsItem = {
  provider: string;
  itemId: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  teams: string[];
  players: string[];
  tags: string[];
  impactDirection: NewsImpactDirection;
  confidence: number;
  sourceReliability: number | null;
};

export type NewsProviderQuery = {
  tournamentId?: string;
  matchId?: string;
  teams?: string[];
  players?: string[];
  publishedFrom?: string;
  publishedTo?: string;
  tags?: string[];
};

export interface NewsProvider extends AgentDataProvider<NormalizedNewsItem, NewsProviderQuery> {}

export type PlayerAvailabilityStatus =
  | 'available'
  | 'doubtful'
  | 'out'
  | 'suspended'
  | 'rested'
  | 'unknown';

export type NormalizedPlayerAvailability = {
  provider: string;
  team: string;
  player: string;
  status: PlayerAvailabilityStatus;
  reason: string | null;
  severity: 'low' | 'medium' | 'high' | 'unknown';
  expectedReturnAt: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  confidence: number;
};

export type InjuryProviderQuery = {
  tournamentId?: string;
  matchId?: string;
  teams?: string[];
  players?: string[];
  updatedFrom?: string;
  updatedTo?: string;
};

export interface InjuryProvider extends AgentDataProvider<NormalizedPlayerAvailability, InjuryProviderQuery> {}

export type FootballContextProviderQuery = {
  tournamentId?: string;
  matchId?: string;
  teams?: string[];
  kickoffAt?: string;
};

export type FootballContextProviderBatch = {
  provider: string;
  fetchedAt: string;
  lineups: NormalizedLineupSnapshot[];
  availability: NormalizedPlayerAvailability[];
  news: NormalizedNewsItem[];
  warnings: string[];
};

export interface FootballContextProvider {
  readonly descriptor: ProviderDescriptor;
  isConfigured(): boolean;
  health(): Promise<ProviderHealth>;
  fetchContext(
    query: FootballContextProviderQuery,
    context?: ProviderRequestContext,
  ): Promise<FootballContextProviderBatch>;
}

export type FootballContextRiskSignal = {
  key:
    | 'lineup_freshness'
    | 'lineup_uncertainty'
    | 'availability_risk'
    | 'suspension_risk'
    | 'news_risk'
    | 'provider_coverage';
  label: string;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  freshness: ProviderFreshnessLabel;
  uncertainty: ProviderUncertaintyLabel;
  detail: string;
};

export type FootballContextRiskReport = {
  matchId: string;
  generatedAt: string;
  model: 'football_context_risk_v1';
  provider: string;
  providerConfigured: boolean;
  overallRisk: 'low' | 'medium' | 'high' | 'unknown';
  freshness: ProviderFreshnessLabel;
  uncertainty: ProviderUncertaintyLabel;
  lineups: {
    home: NormalizedLineupSnapshot | null;
    away: NormalizedLineupSnapshot | null;
  };
  availability: NormalizedPlayerAvailability[];
  suspensions: NormalizedPlayerAvailability[];
  news: NormalizedNewsItem[];
  signals: FootballContextRiskSignal[];
  summary: string;
  warnings: string[];
  assumptions: string[];
};

export type Score = {
  home: number;
  away: number;
};

export type PenaltyWinner = 'Home' | 'Away';

export type ResultStatus =
  | { kind: 'Unresolved' }
  | {
      kind: 'Proposed';
      value: {
        score: Score;
        penalty_winner: PenaltyWinner | null;
        oracle: ActorId;
        proposed_at: U64String;
      };
    }
  | {
      kind: 'Finalized';
      value: {
        score: Score;
        penalty_winner: PenaltyWinner | null;
      };
    }
  | { kind: 'Cancelled' };

export type BolaoMatch = {
  match_id: U64String;
  phase: string;
  home: string;
  away: string;
  kick_off: U64String;
  result: ResultStatus;
  match_prize_pool: U128String;
  has_bets: boolean;
  participants: ActorId[];
  total_winner_stake: U128String;
  total_claimed: U128String;
  settlement_prepared: boolean;
  dust_swept: boolean;
  finalized_at: U64String | null;
};

export type UserBetView = {
  match_id: U64String;
  score: Score;
  penalty_winner: PenaltyWinner | null;
  stake_in_match_pool: U128String;
  freebet_principal: U128String;
  claimed: boolean;
};

export type WalletClaimStatus = {
  wallet: ActorId;
  amount_claimable: U128String;
  already_claimed: boolean;
};

export type FinalPrizeClaimStatus = {
  wallet: ActorId;
  final_prize_finalized: boolean;
  eligible: boolean;
  amount_claimable: U128String;
  already_claimed: boolean;
  points: number;
};

export type PhaseConfig = {
  name: string;
  start_time: U64String;
  end_time: U64String;
  points_weight: number;
};

export type UserPointsEntry = {
  actor_id: ActorId;
  points: number;
};

export type IoSmartCupState = {
  admins: ActorId[];
  operators: ActorId[];
  treasury: ActorId;
  protocol_fee_accumulated: U128String;
  final_prize_accumulated: U128String;
  matches: BolaoMatch[];
  phases: PhaseConfig[];
  user_points: UserPointsEntry[];
  podium_finalized: boolean;
  r32_lock_time: U64String | null;
  final_prize_finalized: boolean;
  final_prize_claimable_total: U128String;
  final_prize_rounding_dust: U128String;
  vara_price_usd_micro: U64String;
  price_cached_at: U64String;
  price_staleness_limit_ms: U64String;
  freebet_ledger_program_id: ActorId | null;
};

export type MatchStatus = 'UNRESOLVED' | 'PROPOSED' | 'FINALIZED' | 'SETTLED' | 'CANCELLED';

export type SmartCupMatch = {
  matchId: string;
  phase: string;
  home: string;
  away: string;
  kickOffMs: number;
  status: MatchStatus;
};

export type MatchEligibilityReason =
  | 'already_predicted'
  | 'cancelled'
  | 'finalized'
  | 'settled'
  | 'result_proposed'
  | 'not_unresolved'
  | 'invalid_kickoff'
  | 'cutoff_buffer_breached';

export type MatchEligibilityView = {
  matchId: U64String;
  phase: string;
  phaseWeight: number | null;
  home: string;
  away: string;
  kickOffMs: number;
  predictionCutoffMs: number;
  agentSafetyCloseMs: number;
  timeUntilSafetyCloseMs: number;
  status: MatchStatus;
  eligible: boolean;
  reasons: MatchEligibilityReason[];
};

export type EligibleMatchPlan = {
  generatedAt: string;
  wallet: ActorId;
  cutoff: TournamentCutoffPolicy;
  totalMatches: number;
  eligibleMatches: MatchEligibilityView[];
  ineligibleMatches: MatchEligibilityView[];
};

export type IndexerPageOptions = {
  first?: number;
};

export type IndexerMatchFilter = IndexerPageOptions & {
  statusIn?: MatchStatus[];
  phase?: string;
};

export type IndexerWalletFilter = IndexerPageOptions & {
  user?: ActorId | string;
};

export type IndexerMatchWalletFilter = IndexerWalletFilter & {
  matchId?: string | number | bigint;
};

export type IndexerActivityFilter = IndexerMatchWalletFilter & {
  type?: string;
};

export type IndexerBolaoMatch = {
  id: string;
  matchId: string;
  phase: string;
  home: string;
  away: string;
  kickOff: string;
  status: MatchStatus;
  scoreHome: number | null;
  scoreAway: number | null;
  penaltyWinner: string | null;
  prizePoolRaw: U128String;
  betsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IndexerBet = {
  id: string;
  user: ActorId | string;
  matchId: string;
  scoreHome: number;
  scoreAway: number;
  penaltyWinner: string | null;
  stakeRaw: U128String;
  blockNumber: U64String;
  timestamp: string;
  matchRef?: IndexerBolaoMatch | null;
};

export type IndexerUserStat = {
  id: ActorId | string;
  totalBets: number;
  totalStakedRaw: U128String;
  totalPoints: number;
  totalClaimedRaw: U128String;
  finalPrizeClaimedRaw: U128String;
  totalRefundClaimedRaw?: U128String;
  updatedAt: string;
};

export type IndexerMatchReward = {
  id: string;
  matchId: string;
  user: ActorId | string;
  amountRaw: U128String;
  blockNumber: U64String;
  timestamp: string;
  matchRef?: IndexerBolaoMatch | null;
};

export type IndexerFinalPrizeClaim = {
  id: string;
  user: ActorId | string;
  amountRaw: U128String;
  blockNumber: U64String;
  timestamp: string;
};

export type IndexerActivityRecord = {
  id: string;
  type: string;
  user: ActorId | string | null;
  matchId: string | null;
  amountRaw: U128String | null;
  points: number | null;
  meta: string | null;
  blockNumber: U64String;
  timestamp: string;
};

export type SmartCupApiPoolDistribution = {
  match_id: string;
  home_bets: number;
  draw_bets: number;
  away_bets: number;
  home_planck: U128String;
  draw_planck: U128String;
  away_planck: U128String;
  total_bets: number;
  total_planck: U128String;
};

export type SmartCupApiPoolsResponse = {
  pools: SmartCupApiPoolDistribution[];
  total: number;
};

export type PoolOutcome = 'home' | 'draw' | 'away';

export type EntrySplitBreakdown = {
  grossEntryPlanck: U128String;
  matchWinnerPoolPlanck: U128String;
  finalPrizePoolPlanck: U128String;
  protocolFeePlanck: U128String;
  dustPlanck: U128String;
  splitBps: TournamentRewardSplit;
};

export type PoolOutcomeDistribution = {
  outcome: PoolOutcome;
  bets: number;
  matchPoolPlanck: U128String;
  shareOfMatchPool: number;
  shareOfBets: number;
};

export type MatchPoolDistributionView = {
  matchId: string;
  source: 'smartcup_api';
  generatedAt: string;
  splitBps: TournamentRewardSplit;
  totalBets: number;
  totalMatchPoolPlanck: U128String;
  inferredGrossEntryPlanck: U128String;
  inferredFinalPrizeContributionPlanck: U128String;
  inferredProtocolFeePlanck: U128String;
  inferredDustPlanck: U128String;
  outcomes: PoolOutcomeDistribution[];
};

export type ExactScoreCrowdEstimate = {
  score: Score;
  outcome: PoolOutcome;
  priorShareWithinOutcome: number;
  estimatedShareOfBets: number;
  estimatedShareOfMatchPool: number;
  estimatedBets: number;
  estimatedMatchPoolPlanck: U128String;
};

export type ExactScoreCrowdingReport = {
  matchId: string;
  generatedAt: string;
  model: 'public_score_priors_v1';
  sourcePoolGeneratedAt: string;
  totalBets: number;
  totalMatchPoolPlanck: U128String;
  outcomeShares: PoolOutcomeDistribution[];
  scoreEstimates: ExactScoreCrowdEstimate[];
  topCrowdedScores: ExactScoreCrowdEstimate[];
  assumptions: string[];
  confidence: number;
};

export type CrowdOutcomeCluster = {
  outcome: PoolOutcome;
  label: string;
  shareOfBets: number;
  shareOfMatchPool: number;
  bets: number;
  crowdLevel: 'low' | 'medium' | 'high';
};

export type PublicScoreCluster = {
  score: Score;
  outcome: PoolOutcome;
  estimatedShareOfBets: number;
  estimatedShareOfMatchPool: number;
  estimatedBets: number;
  clusterLevel: 'low' | 'medium' | 'high';
  reason: string;
};

export type ContrarianScoreOpportunity = {
  score: Score;
  outcome: PoolOutcome;
  forecastProbability: number;
  outcomeProbability: number;
  estimatedCrowdShare: number;
  estimatedCrowdBets: number;
  differentiationScore: number;
  opportunityLevel: 'low' | 'medium' | 'high';
  rationale: string[];
};

export type CrowdContrarianMapReport = {
  matchId: string;
  generatedAt: string;
  model: 'crowd_contrarian_map_v1';
  confidence: number;
  outcomeClusters: CrowdOutcomeCluster[];
  likelyPublicScoreClusters: PublicScoreCluster[];
  differentiatedOpportunities: ContrarianScoreOpportunity[];
  selectedScoreOpportunity: ContrarianScoreOpportunity | null;
  summary: string;
  warnings: string[];
  assumptions: string[];
};

export type CandidatePayoutEv = {
  score: Score;
  outcome: PoolOutcome;
  fundingSource: FundingSource;
  roiBasis: 'cash_profit_over_stake' | 'freebet_payout_over_incentive_amount';
  scoreProbability: number;
  currentEstimatedScorePoolPlanck: U128String;
  candidateStakePlanck: U128String;
  userCapitalAtRiskPlanck: U128String;
  projectedTotalMatchPoolPlanck: U128String;
  projectedScorePoolPlanck: U128String;
  payoutIfExactPlanck: U128String;
  profitIfExactPlanck: string;
  expectedPayoutPlanck: U128String;
  expectedProfitPlanck: string;
  expectedNetValuePlanck: string;
  payoutMultiple: number;
  expectedRoi: number;
  crowdPenalty: number;
};

export type CandidatePayoutEvReport = {
  matchId: string;
  generatedAt: string;
  model: 'score_probability_x_pool_share_v1';
  fundingSource: FundingSource;
  roiBasis: 'cash_profit_over_stake' | 'freebet_payout_over_incentive_amount';
  candidateStakePlanck: U128String;
  userCapitalAtRiskPlanck: U128String;
  totalMatchPoolPlanck: U128String;
  projectedTotalMatchPoolPlanck: U128String;
  candidates: CandidatePayoutEv[];
  topByExpectedProfit: CandidatePayoutEv[];
  assumptions: string[];
};

export type CandidatePointsEv = {
  score: Score;
  outcome: PoolOutcome;
  exactScoreProbability: number;
  outcomeProbability: number;
  exactScorePoints: number;
  outcomePoints: number;
  phaseWeight: number;
  expectedBasePoints: number;
  expectedWeightedPoints: number;
};

export type CandidatePointsEvReport = {
  matchId: string;
  generatedAt: string;
  model: 'smartcup_points_ev_v1';
  phase: string;
  phaseWeight: number;
  scoring: TournamentScoringPolicy;
  candidates: CandidatePointsEv[];
  topByExpectedWeightedPoints: CandidatePointsEv[];
  assumptions: string[];
};

export type LeaderboardProjectedRow = {
  wallet: ActorId | string;
  currentPoints: number;
  projectedPoints: number;
  projectedRank: number;
  finalPrizeBps: number;
  finalPrizeEquityPlanck: U128String;
};

export type CandidateLeaderboardEquity = {
  score: Score;
  outcome: PoolOutcome;
  expectedWeightedPoints: number;
  projectedWalletPoints: number;
  projectedRank: number;
  topFive: boolean;
  finalPrizeBps: number;
  finalPrizeEquityPlanck: U128String;
  equityDeltaPlanck: string;
};

export type LeaderboardEquityReport = {
  matchId: string;
  generatedAt: string;
  model: 'current_board_points_equity_v1';
  wallet: ActorId;
  currentWalletPoints: number;
  currentRank: number;
  currentFinalPrizeBps: number;
  currentFinalPrizeEquityPlanck: U128String;
  finalPrizePoolPlanck: U128String;
  placesPaid: number;
  candidates: CandidateLeaderboardEquity[];
  topByEquity: CandidateLeaderboardEquity[];
  currentTopFive: LeaderboardProjectedRow[];
  assumptions: string[];
};

export type OpponentArchetype =
  | 'favorite_chaser'
  | 'public_score'
  | 'contrarian'
  | 'high_variance'
  | 'leader_protect'
  | 'catch_up'
  | 'inactive'
  | 'unknown';

export type OpponentParticipationProfile = {
  matchesObserved: number;
  predictionsObserved: number;
  participationRate: number;
  recentParticipationRate: number | null;
  averageLeadTimeMinutes: number | null;
  missedOpenMatches: number;
};

export type OpponentScoreTendencyProfile = {
  exactScoreHitRate: number | null;
  outcomeHitRate: number | null;
  drawPickRate: number;
  homePickRate: number;
  awayPickRate: number;
  averageTotalGoalsPicked: number | null;
  averageGoalMarginPicked: number | null;
  commonScorePickRate: number;
  highVarianceScorePickRate: number;
  topPickedScores: Array<{
    score: Score;
    count: number;
    rate: number;
  }>;
};

export type OpponentBiasProfile = {
  favoriteBias: number;
  underdogBias: number;
  contrarianBias: number;
  publicScoreBias: number;
  drawBias: number;
};

export type OpponentStakeProfile = {
  averageStakePlanck: U128String | null;
  medianStakePlanck: U128String | null;
  maxStakePlanck: U128String | null;
  stakeVolatility: number | null;
  stakeTrend: 'increasing' | 'decreasing' | 'flat' | 'unknown';
};

export type OpponentRankPressureProfile = {
  currentRank: number | null;
  currentPoints: number;
  distanceToTopOnePoints: number | null;
  distanceToTopThreePoints: number | null;
  distanceToTopFivePoints: number | null;
  distanceFromSixthPoints: number | null;
  pressureMode: 'leader' | 'top_five' | 'bubble' | 'chasing' | 'inactive' | 'unknown';
};

export type OpponentProfile = {
  wallet: ActorId | string;
  displayName: string | null;
  generatedAt: string;
  dataSources: Array<'chain' | 'indexer' | 'smartcup_api' | 'local_memory' | 'derived'>;
  archetype: OpponentArchetype;
  archetypeConfidence: number;
  participation: OpponentParticipationProfile;
  scoreTendencies: OpponentScoreTendencyProfile;
  biases: OpponentBiasProfile;
  stake: OpponentStakeProfile;
  rankPressure: OpponentRankPressureProfile;
  sampleQuality: {
    score: number;
    label: 'low' | 'medium' | 'high';
    warnings: string[];
  };
};

export type OpponentArchetypeClassification = {
  archetype: OpponentArchetype;
  confidence: number;
  signals: string[];
};

export type OpponentFeatureImportReport = {
  generatedAt: string;
  sources: {
    chain: {
      available: boolean;
      userPointsCount: number;
      matchCount: number;
    };
    smartcupApi: {
      available: boolean;
      leaderboardRows: number;
    };
    indexer: {
      available: boolean;
      betCount: number;
      userStatCount: number;
    };
  };
  profiles: OpponentProfile[];
  warnings: string[];
};

export type OpponentScoreDistributionEntry = {
  score: Score;
  outcome: PoolOutcome;
  probability: number;
  forecastProbability: number;
  crowdShare: number;
  signals: string[];
};

export type OpponentPredictionSample = {
  wallet: ActorId | string;
  displayName: string | null;
  archetype: OpponentArchetype;
  archetypeConfidence: number;
  currentPoints: number;
  participationProbability: number;
  willParticipate: boolean;
  selectedScore: Score | null;
  selectedOutcome: PoolOutcome | null;
  rankPressureMode: OpponentRankPressureProfile['pressureMode'];
  distributionTop: OpponentScoreDistributionEntry[];
};

export type OpponentPredictionSamplerReport = {
  matchId: string;
  generatedAt: string;
  model: 'opponent_archetype_sampler_v1';
  seed: string;
  phase: string;
  totalOpponents: number;
  expectedParticipants: number;
  samples: OpponentPredictionSample[];
  assumptions: string[];
};

export type MonteCarloBlockerWallet = {
  wallet: ActorId | string;
  aheadOrTiedRate: number;
};

export type MonteCarloCandidateSummary = {
  score: Score;
  outcome: PoolOutcome;
  iterations: number;
  topOneProbability: number;
  topThreeProbability: number;
  topFiveProbability: number;
  expectedRank: number;
  medianRank: number;
  bestRank: number;
  worstRank: number;
  rankStdDev: number;
  expectedFinalPrizeEquityPlanck: U128String;
  equityDeltaPlanck: string;
  blockerWallets: MonteCarloBlockerWallet[];
};

export type MonteCarloLeaderboardSimulationReport = {
  matchId: string;
  generatedAt: string;
  model: 'monte_carlo_leaderboard_v1';
  seed: string;
  iterations: number;
  wallet: ActorId;
  currentWalletPoints: number;
  currentRank: number;
  currentFinalPrizeEquityPlanck: U128String;
  finalPrizePoolPlanck: U128String;
  candidates: MonteCarloCandidateSummary[];
  topByExpectedEquity: MonteCarloCandidateSummary[];
  assumptions: string[];
};

export type OpponentAwareCandidateOutput = {
  score: Score;
  outcome: PoolOutcome;
  probabilities: {
    top1: number;
    top3: number;
    top5: number;
  };
  finalPrize: {
    expectedEquityPlanck: U128String;
    equityDeltaPlanck: string;
  };
  rank: {
    expected: number;
    median: number;
    best: number;
    worst: number;
    volatility: number;
  };
  blockerWallets: MonteCarloBlockerWallet[];
};

export type OpponentAwareOutputReport = {
  matchId: string;
  generatedAt: string;
  model: 'opponent_aware_outputs_v1';
  objective: string;
  seed: string;
  iterations: number;
  outputs: OpponentAwareCandidateOutput[];
  bestByEquity: OpponentAwareCandidateOutput | null;
  bestByTopFive: OpponentAwareCandidateOutput | null;
};

export type RiskModeCandidateScore = {
  score: Score;
  outcome: PoolOutcome;
  riskMode: RiskMode;
  fundingSource: FundingSource;
  utility: number;
  components: {
    forecast: number;
    payout: number;
    points: number;
    leaderboard: number;
    topFive: number;
    contrarian: number;
    rankSafety: number;
    rankUpside: number;
  };
  rationale: string[];
};

export type RiskModeEvaluationReport = {
  matchId: string;
  generatedAt: string;
  model: 'risk_mode_utility_v1';
  riskMode: RiskMode;
  fundingSource: FundingSource;
  candidates: RiskModeCandidateScore[];
  selected: RiskModeCandidateScore | null;
  weights: Record<keyof RiskModeCandidateScore['components'], number>;
};

export type AlternativePickKind = 'safest' | 'balanced' | 'contrarian' | 'leaderboard_upside';

export type AlternativePickRecommendation = {
  kind: AlternativePickKind;
  label: string;
  score: Score;
  outcome: PoolOutcome;
  sourceRiskMode: RiskMode;
  utility: number;
  confidence: 'low' | 'medium' | 'high';
  exactScoreProbability: number;
  expectedWeightedPoints: number | null;
  expectedRoi: number | null;
  topFiveProbability: number | null;
  finalPrizeEquityDeltaPlanck: string | null;
  components: RiskModeCandidateScore['components'];
  rationale: string[];
};

export type AlternativePickSetReport = {
  matchId: string;
  generatedAt: string;
  model: 'alternative_pick_set_v1';
  picks: AlternativePickRecommendation[];
  summary: string;
  warnings: string[];
  assumptions: string[];
};

export type ConfidenceDegradationLevel = 'none' | 'minor' | 'moderate' | 'severe';

export type ConfidenceSourceFactor = {
  source: 'chain' | 'indexer' | 'smartcup_api' | 'odds' | 'football_context' | 'crowd' | 'leaderboard' | 'simulation';
  label: string;
  status: 'healthy' | 'partial' | 'degraded' | 'missing';
  penalty: number;
  detail: string;
};

export type ConfidenceDegradationReport = {
  matchId: string;
  generatedAt: string;
  model: 'confidence_degradation_v1';
  originalConfidence: number;
  adjustedConfidence: number;
  originalLabel: 'low' | 'medium' | 'high';
  adjustedLabel: 'low' | 'medium' | 'high';
  degradationLevel: ConfidenceDegradationLevel;
  coverageScore: number;
  totalPenalty: number;
  sourceFactors: ConfidenceSourceFactor[];
  summary: string;
  suggestedRetryAt: string | null;
  warnings: string[];
  assumptions: string[];
};

export type SourceQualityLabel = 'healthy' | 'usable' | 'degraded' | 'critical';

export type SourceQualityReport = {
  matchId: string;
  generatedAt: string;
  model: 'source_quality_v1';
  score: number;
  label: SourceQualityLabel;
  coverageScore: number;
  degradedReadWarnings: string[];
  suggestedRetryAt: string | null;
  retryReason: string | null;
  factors: ConfidenceSourceFactor[];
  summary: string;
  assumptions: string[];
};

export type TournamentPositionPosture = 'leading' | 'mid_table' | 'catch_up' | 'final_swing';

export type TournamentPositionStrategySignal = {
  key:
    | 'rank_position'
    | 'leader_gap'
    | 'next_rank_gap'
    | 'top_five_gap'
    | 'phase_leverage'
    | 'selected_pick_fit';
  label: string;
  posture: TournamentPositionPosture;
  severity: 'low' | 'medium' | 'high';
  detail: string;
};

export type TournamentPositionStrategyReport = {
  matchId: string;
  generatedAt: string;
  model: 'tournament_position_strategy_v1';
  wallet: ActorId;
  rankingSource: 'chain_user_points' | 'profile_leaderboard_fallback' | 'none';
  currentRank: number | null;
  currentPoints: number;
  totalRankedWallets: number;
  pointsBehindLeader: number | null;
  pointsBehindNextRank: number | null;
  pointsAheadNextRank: number | null;
  pointsBehindTopFive: number | null;
  pointsAheadSixth: number | null;
  selectedPosture: TournamentPositionPosture;
  recommendedRiskMode: RiskMode;
  recommendedObjective: RiskMode;
  recommendation: string;
  confidence: 'low' | 'medium' | 'high';
  phase: string;
  phaseWeight: number;
  signals: TournamentPositionStrategySignal[];
  rationale: string[];
  warnings: string[];
};

export type SmartCupApiLeaderboardRow = {
  wallet_address: ActorId | string;
  display_name: string | null;
  matches_count: number;
  exact_count: number;
  outcome_count: number;
  total_claimed_planck: U128String;
  updated_at?: string | null;
};

export type SmartCupApiLeaderboardResponse = {
  rows: SmartCupApiLeaderboardRow[];
  total: number;
};

export type SmartCupApiWalletProfile = {
  wallet_address: ActorId | string;
  display_name: string | null;
  updated_at?: string | null;
};

export type AccountReadinessCheckStatus = 'ok' | 'warning' | 'error' | 'unknown';

export type AccountReadinessCheck = {
  status: AccountReadinessCheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type AccountReadinessReport = {
  generatedAt: string;
  wallet: {
    accountName: string;
    configuredHex: ActorId;
    configuredSs58: string;
    localWallet: AccountReadinessCheck;
    balance: AccountReadinessCheck & {
      freePlanck?: U128String;
      raw?: unknown;
    };
  };
  smartcup: {
    terms: AccountReadinessCheck & {
      localStorageKey: string;
    };
    profile: AccountReadinessCheck & {
      displayName?: string | null;
      updatedAt?: string | null;
    };
    currentPredictions: AccountReadinessCheck & {
      bets: UserBetView[];
    };
    points: AccountReadinessCheck & {
      value?: number;
    };
  };
  readyForReadOnly: boolean;
  readyForAutonomousWrites: boolean;
};

export type PredictionSource = 'manual' | 'agent_recommendation' | 'agent_execution' | 'imported_chain';

export type StoredPrediction = {
  id: string;
  source: PredictionSource;
  walletAddress: ActorId;
  matchId: U64String;
  score: Score;
  penaltyWinner: PenaltyWinner | null;
  predictedOutcome: 'home' | 'draw' | 'away';
  amountPlanck: U128String;
  matchPoolAmountPlanck: U128String;
  createdAt: string;
  importedAt: string;
  notes?: string;
};

export type DecisionReport = {
  id: string;
  generatedAt: string;
  schemaVersion: 'smartpredictor.decision_report.v1';
  modelVersions: {
    forecast: string;
    crowding: string;
    payoutEv: string;
    pointsEv: string;
    simulation: string;
    opponentAware: string;
    risk: string;
    marketComparison: string;
    timingStrategy: string;
    crowdContrarianMap: string;
    footballContextRisk: string;
    tournamentPositionStrategy: string;
    alternativePickSet: string;
    confidenceDegradation: string;
    sourceQuality: string;
  };
  wallet: {
    accountName: string;
    address: ActorId;
    ss58: string;
  };
  matchId: string;
  match: SmartCupMatch;
  tournament: {
    id: string;
    name: string;
    phase: string;
    phaseWeight: number;
  };
  riskMode: RiskMode;
  selected: {
    score: Score;
    outcome: PoolOutcome;
    penaltyWinner: PenaltyWinner | null;
    utility: number;
    confidence: number;
  };
  probabilities: {
    exactScore: number;
    home: number;
    draw: number;
    away: number;
  };
  economics: {
    fundingSource: FundingSource;
    roiBasis: 'cash_profit_over_stake' | 'freebet_payout_over_incentive_amount';
    stakePlanck: U128String;
    userCapitalAtRiskPlanck: U128String;
    expectedRoi: number | null;
    expectedProfitPlanck: string | null;
    expectedNetValuePlanck: string | null;
    payoutIfExactPlanck: U128String | null;
    expectedWeightedPoints: number | null;
    topFiveProbability: number | null;
    expectedFinalPrizeEquityPlanck: U128String | null;
    finalPrizeEquityDeltaPlanck: string | null;
    varaUsdPrice?: {
      source: 'oracle' | 'bolao_state';
      priceUsdMicro: string;
      updatedAt: string | null;
    } | null;
  };
  sourceSnapshots: {
    chain: {
      finalPrizeAccumulatedPlanck: U128String;
      protocolFeeAccumulatedPlanck: U128String;
      userPoints: UserPointsEntry[];
      phaseCount: number;
      r32LockTime: U64String | null;
      podiumFinalized: boolean;
      freebetLedgerProgramId: ActorId | null;
    };
    pool: MatchPoolDistributionView;
    tournamentProfile: {
      tournamentId: string;
      name: string;
      phaseWeights: Array<{
        key: string;
        name: string;
        pointsWeight: number;
        weightSource: string;
      }>;
      cutoff: TournamentCutoffPolicy;
      scoring: TournamentScoringPolicy;
      rewardSplit: TournamentRewardSplit;
      finalPrize: TournamentFinalPrizePolicy;
    };
    opponentSamples: OpponentPredictionSamplerReport;
    odds: NormalizedOddsSnapshot[];
    footballContext: {
      lineups: NormalizedLineupSnapshot[];
      availability: NormalizedPlayerAvailability[];
      news: NormalizedNewsItem[];
    };
  };
  candidates: {
    risk: RiskModeCandidateScore[];
    payoutEv: CandidatePayoutEv[];
    pointsEv: CandidatePointsEv[];
    opponentAware: OpponentAwareCandidateOutput[];
  };
  sections: {
    forecast: unknown;
    pool: MatchPoolDistributionView;
    crowding: ExactScoreCrowdingReport;
    payoutEv: CandidatePayoutEvReport;
    pointsEv: CandidatePointsEvReport;
    simulation: unknown;
    opponentAware: OpponentAwareOutputReport;
    risk: RiskModeEvaluationReport;
    marketComparison: MarketOddsComparisonReport;
    timingStrategy: TimingStrategyReport;
    crowdContrarianMap: CrowdContrarianMapReport;
    footballContextRisk: FootballContextRiskReport;
    tournamentPositionStrategy: TournamentPositionStrategyReport;
    alternativePickSet: AlternativePickSetReport;
    confidenceDegradation: ConfidenceDegradationReport;
    sourceQuality: SourceQualityReport;
  };
  sourceWarnings: string[];
  summary: {
    headline: string;
    recommendation: string;
    confidenceLabel: 'low' | 'medium' | 'high';
    bullets: string[];
  };
  rationale: string[];
};

export type TransactionKind =
  | 'PlaceBet'
  | 'SpendFreebet'
  | 'SubmitPodiumPick'
  | 'ClaimMatchReward'
  | 'ClaimRefund'
  | 'ClaimFinalPrize';

export type TransactionPlanStatus =
  | 'planned'
  | 'blocked'
  | 'approved'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export type TransactionSafetyCheckStatus = 'pass' | 'warning' | 'fail' | 'not_evaluated';

export type TransactionSafetyCheck = {
  name: string;
  status: TransactionSafetyCheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type StoredTransactionPlan = {
  id: string;
  createdAt: string;
  updatedAt: string;
  decisionId: string | null;
  kind: TransactionKind;
  status: TransactionPlanStatus;
  wallet: ActorId;
  programId: HexAddress;
  method: string;
  args: unknown[];
  valuePlanck: U128String;
  riskMode: RiskMode | null;
  requiresApproval: boolean;
  safetyChecks: TransactionSafetyCheck[];
  summary: string;
  payload: Record<string, unknown>;
};

export type TransactionResultStatus =
  | 'not_submitted'
  | 'submission_blocked'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'unknown';

export type StoredTransactionResult = {
  id: string;
  planId: string;
  createdAt: string;
  updatedAt: string;
  status: TransactionResultStatus;
  txHash: string | null;
  messageId: string | null;
  blockHash: string | null;
  blockNumber: U64String | null;
  error: string | null;
  chainReadback: unknown | null;
  payload: Record<string, unknown>;
};

export type OutcomeEvaluationStatus = 'pending' | 'evaluated';

export type OutcomeErrorClassification =
  | 'none'
  | 'pending_result'
  | 'football_model'
  | 'scoreline_strategy'
  | 'execution'
  | 'payout_pending'
  | 'unknown';

export type StoredOutcomeEvaluation = {
  id: string;
  decisionId: string;
  matchId: string;
  evaluatedAt: string;
  status: OutcomeEvaluationStatus;
  predicted: {
    score: Score;
    outcome: PoolOutcome;
    penaltyWinner: PenaltyWinner | null;
  };
  actual: {
    resultStatus: ResultStatus['kind'];
    score: Score | null;
    outcome: PoolOutcome | null;
    penaltyWinner: PenaltyWinner | null;
    finalizedAt: U64String | null;
  };
  points: {
    awardedBasePoints: number | null;
    awardedWeightedPoints: number | null;
    phaseWeight: number;
  };
  payout: {
    status: 'not_available' | 'pending' | 'claimable' | 'claimed' | 'unknown';
    amountClaimablePlanck: U128String | null;
    alreadyClaimed: boolean | null;
  };
  errorClassification: OutcomeErrorClassification;
  notes: string[];
  chainReadback: unknown | null;
  payload: Record<string, unknown>;
};

export type PostMatchCalibrationEntry = {
  decisionId: string;
  evaluationId: string;
  matchId: string;
  evaluatedAt: string;
  tournamentId: string;
  riskMode: RiskMode;
  predictedScore: Score;
  actualScore: Score;
  predictedOutcome: PoolOutcome;
  actualOutcome: PoolOutcome;
  exactHit: boolean;
  outcomeHit: boolean;
  predictedExactProbability: number;
  predictedProbabilityForSelectedOutcome: number;
  predictedProbabilityForActualOutcome: number;
  brierScore: number;
  logLoss: number;
  confidence: number;
  confidenceLabel: DecisionReport['summary']['confidenceLabel'];
  sourceQualityScore: number | null;
  sourceQualityLabel: SourceQualityReport['label'] | null;
  awardedWeightedPoints: number | null;
  expectedWeightedPoints: number | null;
  modelVersions: DecisionReport['modelVersions'];
  notes: string[];
};

export type PostMatchCalibrationReport = {
  id: string;
  generatedAt: string;
  schemaVersion: 'smartpredictor.post_match_calibration_report.v1';
  model: 'post_match_calibration_v1';
  filters: {
    tournamentId: string | null;
    matchId: string | null;
    limit: number | null;
  };
  sampleSize: number;
  exactHits: number;
  outcomeHits: number;
  exactHitRate: number;
  outcomeHitRate: number;
  averagePredictedExactProbability: number;
  averagePredictedProbabilityForActualOutcome: number;
  averageBrierScore: number;
  averageLogLoss: number;
  averageConfidence: number;
  averageSourceQualityScore: number | null;
  averageAwardedWeightedPoints: number | null;
  averageExpectedWeightedPoints: number | null;
  pointsDelta: number | null;
  entries: PostMatchCalibrationEntry[];
  modelUpdateNotes: string[];
  assumptions: string[];
  warnings: string[];
};

export type AnalysisProductKey =
  | 'single_match'
  | 'five_match_bundle'
  | 'podium_strategy'
  | 'tournament_advisory';

export type RecommendationPillar = 'personal_operator';

export type AnalysisProductMatchScope =
  | 'one_match'
  | 'exactly_five_matches'
  | 'podium_pick'
  | 'tournament_plan';

export type AnalysisProductReportArtifact =
  | 'decision_report'
  | 'bundle_report'
  | 'podium_report'
  | 'tournament_advisory_report'
  | 'markdown_export'
  | 'json_export';

export type AnalysisProductPermissionProfile = {
  pillar: RecommendationPillar;
  canSaveDecisionReport: boolean;
  canAttachApproval: boolean;
  canExecuteWalletAction: boolean;
  notes: string[];
};

export type AnalysisProductDefinition = {
  key: AnalysisProductKey;
  name: string;
  shortName: string;
  description: string;
  matchScope: AnalysisProductMatchScope;
  targetMatchCount: number | null;
  defaultObjective: string;
  defaultPriceUsd: number | null;
  supportedPillars: RecommendationPillar[];
  requiredInputs: string[];
  reportArtifacts: AnalysisProductReportArtifact[];
  personal: AnalysisProductPermissionProfile;
};

export type PodiumStrategyPosition = 'champion' | 'runner_up' | 'third_place';

export type PodiumStrategyPick = {
  position: PodiumStrategyPosition;
  team: string;
  rating: number;
  confidence: number;
  reasoning: string[];
};

export type PodiumStrategySlate = {
  champion: string;
  runnerUp: string;
  thirdPlace: string;
  rationale: string[];
};

export type PodiumStrategyReport = {
  schemaVersion: 'smartpredictor.podium_strategy_report.v1';
  id: string;
  generatedAt: string;
  product: 'podium_strategy';
  pillar: 'personal_operator';
  tournament: {
    id: string;
    name: string;
    season: string;
    timezone: string;
  };
  timingWindow: {
    enabled: boolean;
    status: 'disabled' | 'pre_window' | 'open' | 'closed' | 'unknown';
    phaseKey: TournamentPhaseKey | null;
    targetMatchId: U64String | null;
    targetMatchLabel: string | null;
    expectedMatchupDefinedAt: string | null;
    kickoffAt: string | null;
    opportunityWindowHours: { min: number; max: number } | null;
    lockSource: string | null;
    hoursUntilExpectedMatchup: number | null;
    hoursUntilKickoff: number | null;
  };
  recommendation: {
    champion: PodiumStrategyPick;
    runnerUp: PodiumStrategyPick;
    thirdPlace: PodiumStrategyPick;
  };
  alternatives: PodiumStrategySlate[];
  confidence: {
    score: number;
    label: 'low' | 'medium' | 'high';
    drivers: string[];
  };
  bonusPoints: ChampionshipPickBonusPolicy | null;
  tournamentPathAssumptions: string[];
  sourceWarnings: string[];
  notes: string[];
  payload: Record<string, unknown>;
};

export type TournamentAdvisoryPriorityMatch = {
  matchId: U64String;
  label: string;
  phase: string;
  phaseWeight: number | null;
  kickOffAt: string;
  safetyCloseAt: string;
  hoursUntilSafetyClose: number;
  priorityScore: number;
  rationale: string[];
};

export type TournamentAdvisoryReport = {
  schemaVersion: 'smartpredictor.tournament_advisory_report.v1';
  id: string;
  generatedAt: string;
  product: 'tournament_advisory';
  pillar: 'personal_operator';
  tournament: {
    id: string;
    name: string;
    season: string;
    timezone: string;
  };
  wallet: {
    accountName: string;
    address: ActorId;
  };
  rollingPlan: {
    reviewCadence: string;
    currentPhase: string | null;
    openEligibleMatches: number;
    phaseFocus: string[];
  };
  priorityMatches: TournamentAdvisoryPriorityMatch[];
  riskPosture: {
    defaultRiskMode: RiskMode;
    strategyPosture: StrategyPosture;
    rationale: string[];
  };
  leaderboardObjective: {
    objective: RiskMode;
    label: string;
    rationale: string[];
  };
  stakeExposure: {
    minStakeUsd: string | null;
    maxStakeUsd: string | null;
    maxStakePlanck: U128String;
    maxTournamentExposureUsd: string | null;
    maxTournamentExposurePlanck: U128String;
    existingPredictionCount: number;
    existingPredictionCountSource: string;
    existingStakeInMatchPoolsPlanck: U128String;
    existingFreebetPrincipalPlanck: U128String;
    storedOpenPlanExposurePlanck: U128String;
    notes: string[];
  };
  nextActions: string[];
  sourceWarnings: string[];
  notes: string[];
  payload: Record<string, unknown>;
};

export type ParserTelemetryActionTaken =
  | 'user_help'
  | 'user_agent_status'
  | 'user_tournament_select'
  | 'user_eligible_matches'
  | 'user_freebet_status'
  | 'user_refund_status'
  | 'user_strategy_preferences'
  | 'operator_decision_preview'
  | 'operator_market_analysis'
  | 'operator_timing_strategy'
  | 'operator_crowd_contrarian_map'
  | 'operator_football_context_risk'
  | 'operator_tournament_position_strategy'
  | 'operator_alternative_pick_set'
  | 'operator_leaderboard_analysis'
  | 'operator_saved_reports'
  | 'operator_personal_bundle'
  | 'operator_personal_podium_strategy'
  | 'operator_personal_tournament_advisory'
  | 'operator_calibration_report'
  | 'operator_export_report'
  | 'operator_policy'
  | 'operator_claim_pending'
  | 'operator_approval_button_rendered'
  | 'operator_approval_rejected'
  | 'clarification_prompt'
  | 'permission_denied'
  | 'parser_preview';

export type ParserTelemetrySafetyOutcome =
  | 'read_only'
  | 'local_preference_stored'
  | 'decision_preview_saved'
  | 'explicit_button_required'
  | 'policy_change'
  | 'clarification_required'
  | 'permission_denied'
  | 'blocked'
  | 'no_action';

export type StoredParserTelemetry = {
  id: string;
  createdAt: string;
  transport: 'telegram';
  rawTextHash: `0x${string}`;
  rawTextLength: number;
  chatHash: `0x${string}` | null;
  userHash: `0x${string}` | null;
  parsedIntent: string;
  parsedPermission: string;
  parsedSafety: string;
  slots: Record<string, unknown>;
  confidence: number;
  missingRequiredSlots: string[];
  ambiguousSlots: string[];
  actionTaken: ParserTelemetryActionTaken;
  safetyOutcome: ParserTelemetrySafetyOutcome;
  details: Record<string, unknown>;
};

export type TelegramPreferenceRole = 'user' | 'operator';
export type TelegramPreferenceUpdateSource =
  | 'button'
  | 'cli'
  | 'natural_language'
  | 'slash_command'
  | 'smoke'
  | 'system';
export type StrategyPosture = RiskMode;

export type StoredTelegramPreference = {
  id: string;
  createdAt: string;
  updatedAt: string;
  transport: 'telegram';
  role: TelegramPreferenceRole;
  subjectId: string;
  subjectHash: `0x${string}`;
  tournamentId: string;
  defaultRiskMode: RiskMode;
  simulationObjective: RiskMode;
  strategyPosture: StrategyPosture;
  updatedBy: TelegramPreferenceUpdateSource;
  notes: string[];
  payload: Record<string, unknown>;
};

export type RuntimePolicyUpdateSource =
  | 'env'
  | 'telegram_button'
  | 'telegram_command'
  | 'telegram_natural_language'
  | 'cli'
  | 'system';

export type StoredRuntimePolicy = {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: ExecutionMode;
  source: RuntimePolicyUpdateSource;
  updatedBy: string | null;
  startupEnvMode: ExecutionMode;
  notes: string[];
  payload: Record<string, unknown>;
};

export type StoredTelegramPredictionAlert = {
  id: string;
  createdAt: string;
  sentAt: string;
  chatId: string;
  tournamentId: string;
  tournamentName: string;
  matchId: U64String;
  home: string;
  away: string;
  phase: string;
  kickOffAt: string;
  predictionCutoffAt: string;
  agentSafetyCloseAt: string;
  alertLeadMinutes: number;
  walletAddress: ActorId;
  payload: Record<string, unknown>;
};
