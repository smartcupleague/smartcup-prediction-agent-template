import type {
  ActorId,
  AgentConfig,
  IndexerBet,
  IndexerUserStat,
  IoSmartCupState,
  OpponentArchetypeClassification,
  OpponentFeatureImportReport,
  OpponentProfile,
  Score,
  SmartCupApiLeaderboardRow,
  U128String,
  UserPointsEntry,
} from '../types/index.js';
import { BolaoChainClient } from './bolao-chain-client.js';
import { IndexerAdapter } from './indexer-adapter.js';
import { SmartCupApiAdapter } from './smartcup-api-adapter.js';

type WalletAccumulator = {
  wallet: ActorId | string;
  displayName: string | null;
  currentPoints: number;
  apiMatchesCount: number | null;
  bets: IndexerBet[];
  userStat: IndexerUserStat | null;
  sources: OpponentProfile['dataSources'];
};

type ImportInputs = {
  state: IoSmartCupState;
  leaderboardRows: SmartCupApiLeaderboardRow[];
  bets: IndexerBet[];
  userStats: IndexerUserStat[];
  warnings: string[];
  sourceStatus: OpponentFeatureImportReport['sources'];
};

const COMMON_SCORE_KEYS = new Set(['1-0', '2-1', '1-1', '2-0', '0-1', '0-0', '1-2', '2-2']);

export class OpponentFeatureAdapter {
  private readonly chain: BolaoChainClient;
  private readonly smartcupApi: SmartCupApiAdapter;
  private readonly indexer: IndexerAdapter;

  constructor(private readonly config: AgentConfig) {
    this.chain = new BolaoChainClient(config);
    this.smartcupApi = new SmartCupApiAdapter(config.services.smartcupApiUrl);
    this.indexer = new IndexerAdapter(config.services.indexerGraphqlUrl, config.services.indexerGraphqlTimeoutMs);
  }

  async importProfiles(options: { limit?: number } = {}): Promise<OpponentFeatureImportReport> {
    const warnings: string[] = [];
    const state = await this.chain.queryState();
    const leaderboardRowsPromise = this.readLeaderboard(warnings);
    const bets = await this.readBets(warnings, options.limit);
    const userStats = await this.readUserStats(warnings, options.limit);
    const leaderboardRows = await leaderboardRowsPromise;

    const sourceStatus: OpponentFeatureImportReport['sources'] = {
      chain: {
        available: true,
        userPointsCount: state.user_points.length,
        matchCount: state.matches.length,
      },
      smartcupApi: {
        available: !warnings.some((warning) => warning.startsWith('SmartCup API leaderboard unavailable')),
        leaderboardRows: leaderboardRows.length,
      },
      indexer: {
        available: !warnings.some((warning) => warning.startsWith('Indexer')),
        betCount: bets.length,
        userStatCount: userStats.length,
      },
    };

    const profiles = buildProfiles({ state, leaderboardRows, bets, userStats, warnings, sourceStatus });

    return {
      generatedAt: new Date().toISOString(),
      sources: sourceStatus,
      profiles,
      warnings,
    };
  }

  private async readLeaderboard(warnings: string[]): Promise<SmartCupApiLeaderboardRow[]> {
    try {
      return (await this.smartcupApi.getLeaderboardEnrichment()).rows;
    } catch (error) {
      warnings.push(`SmartCup API leaderboard unavailable: ${errorMessage(error)}`);
      return [];
    }
  }

  private async readBets(warnings: string[], limit = 500): Promise<IndexerBet[]> {
    try {
      return await this.indexer.listBets({ first: limit });
    } catch (error) {
      warnings.push(`Indexer bets unavailable: ${errorMessage(error)}`);
      return [];
    }
  }

  private async readUserStats(warnings: string[], limit = 500): Promise<IndexerUserStat[]> {
    try {
      return await this.indexer.listUserStats({ first: limit });
    } catch (error) {
      warnings.push(`Indexer user stats unavailable: ${errorMessage(error)}`);
      return [];
    }
  }
}

function buildProfiles(inputs: ImportInputs): OpponentProfile[] {
  const accumulators = new Map<string, WalletAccumulator>();
  const pointRanks = rankUserPoints(inputs.state.user_points);

  for (const entry of inputs.state.user_points) {
    const acc = ensureWallet(accumulators, entry.actor_id);
    acc.currentPoints = entry.points;
    addSource(acc, 'chain');
  }

  for (const row of inputs.leaderboardRows) {
    const acc = ensureWallet(accumulators, row.wallet_address);
    acc.displayName = row.display_name;
    acc.apiMatchesCount = row.matches_count;
    addSource(acc, 'smartcup_api');
  }

  for (const stat of inputs.userStats) {
    const acc = ensureWallet(accumulators, stat.id);
    acc.userStat = stat;
    if (acc.currentPoints === 0) acc.currentPoints = stat.totalPoints;
    addSource(acc, 'indexer');
  }

  for (const bet of inputs.bets) {
    const acc = ensureWallet(accumulators, bet.user);
    acc.bets.push(bet);
    addSource(acc, 'indexer');
  }

  const sortedRows = [...accumulators.values()].sort((left, right) => {
    const pointsDiff = right.currentPoints - left.currentPoints;
    if (pointsDiff !== 0) return pointsDiff;
    return normalizeWallet(left.wallet).localeCompare(normalizeWallet(right.wallet));
  });

  return sortedRows.map((acc) => buildProfile(acc, inputs.state.matches.length, pointRanks));
}

function buildProfile(
  acc: WalletAccumulator,
  matchCount: number,
  pointRanks: Map<string, { rank: number; topOne: number; topThree: number | null; topFive: number | null; sixth: number | null }>,
): OpponentProfile {
  const observedPredictions = Math.max(acc.bets.length, acc.apiMatchesCount ?? 0, acc.userStat?.totalBets ?? 0);
  const participationRate = matchCount <= 0 ? 0 : clamp01(observedPredictions / matchCount);
  const rank = pointRanks.get(normalizeWallet(acc.wallet));
  const scoreTendencies = scoreTendenciesFromBets(acc.bets);
  const stake = stakeProfileFromBets(acc.bets);
  const warnings = sampleWarnings(observedPredictions, acc.sources);
  const sampleScore = sampleQualityScore(observedPredictions, acc.sources.length);
  const rankPressure = {
    currentRank: rank?.rank ?? null,
    currentPoints: acc.currentPoints,
    distanceToTopOnePoints: rank ? round(Math.max(0, rank.topOne - acc.currentPoints)) : null,
    distanceToTopThreePoints:
      rank?.topThree === null || rank?.topThree === undefined ? null : round(Math.max(0, rank.topThree - acc.currentPoints)),
    distanceToTopFivePoints:
      rank?.topFive === null || rank?.topFive === undefined ? null : round(Math.max(0, rank.topFive - acc.currentPoints)),
    distanceFromSixthPoints: rank?.sixth === null || rank?.sixth === undefined ? null : round(acc.currentPoints - rank.sixth),
    pressureMode: pressureMode(rank?.rank ?? null, acc.currentPoints, participationRate),
  } satisfies OpponentProfile['rankPressure'];
  const biases = {
    favoriteBias: 0.5,
    underdogBias: 0.5,
    contrarianBias: round(1 - scoreTendencies.commonScorePickRate),
    publicScoreBias: scoreTendencies.commonScorePickRate,
    drawBias: scoreTendencies.drawPickRate,
  } satisfies OpponentProfile['biases'];
  const participation = {
    matchesObserved: matchCount,
    predictionsObserved: observedPredictions,
    participationRate: round(participationRate),
    recentParticipationRate: null,
    averageLeadTimeMinutes: averageLeadTimeMinutes(acc.bets),
    missedOpenMatches: Math.max(0, matchCount - observedPredictions),
  } satisfies OpponentProfile['participation'];
  const classification = classifyOpponent({
    participation,
    scoreTendencies,
    biases,
    stake,
    rankPressure,
    sampleQualityScore: sampleScore,
  });

  return {
    wallet: acc.wallet,
    displayName: acc.displayName,
    generatedAt: new Date().toISOString(),
    dataSources: [...new Set([...acc.sources, 'derived' as const])],
    archetype: classification.archetype,
    archetypeConfidence: classification.confidence,
    participation,
    scoreTendencies,
    biases,
    stake,
    rankPressure,
    sampleQuality: {
      score: sampleScore,
      label: sampleScore >= 0.7 ? 'high' : sampleScore >= 0.35 ? 'medium' : 'low',
      warnings: [...warnings, ...classification.signals.map((signal) => `archetype: ${signal}`)],
    },
  };
}

type ClassificationInput = {
  participation: OpponentProfile['participation'];
  scoreTendencies: OpponentProfile['scoreTendencies'];
  biases: OpponentProfile['biases'];
  stake: OpponentProfile['stake'];
  rankPressure: OpponentProfile['rankPressure'];
  sampleQualityScore: number;
};

function classifyOpponent(input: ClassificationInput): OpponentArchetypeClassification {
  const signals: string[] = [];
  const confidenceCap = input.sampleQualityScore < 0.35 ? 0.35 : input.sampleQualityScore < 0.7 ? 0.65 : 0.9;

  if (input.participation.predictionsObserved === 0 || input.participation.participationRate < 0.02) {
    signals.push('low or absent participation');
    return { archetype: 'inactive', confidence: round(Math.min(confidenceCap, 0.55)), signals };
  }

  if (input.rankPressure.pressureMode === 'leader' || input.rankPressure.pressureMode === 'top_five') {
    signals.push(`rank pressure mode ${input.rankPressure.pressureMode}`);
    return { archetype: 'leader_protect', confidence: round(Math.min(confidenceCap, 0.6)), signals };
  }

  if (input.rankPressure.pressureMode === 'bubble' || input.rankPressure.pressureMode === 'chasing') {
    signals.push(`rank pressure mode ${input.rankPressure.pressureMode}`);
    return { archetype: 'catch_up', confidence: round(Math.min(confidenceCap, 0.6)), signals };
  }

  if (input.scoreTendencies.highVarianceScorePickRate >= 0.35 || (input.scoreTendencies.averageTotalGoalsPicked ?? 0) >= 4) {
    signals.push('high variance score tendency');
    return { archetype: 'high_variance', confidence: round(Math.min(confidenceCap, 0.7)), signals };
  }

  if (input.biases.contrarianBias >= 0.65 && input.participation.predictionsObserved >= 3) {
    signals.push('low public-score/common-score tendency');
    return { archetype: 'contrarian', confidence: round(Math.min(confidenceCap, 0.65)), signals };
  }

  if (input.biases.publicScoreBias >= 0.55 || input.scoreTendencies.commonScorePickRate >= 0.55) {
    signals.push('common public-score tendency');
    return { archetype: 'public_score', confidence: round(Math.min(confidenceCap, 0.75)), signals };
  }

  if (input.scoreTendencies.drawPickRate <= 0.15 && input.participation.predictionsObserved >= 3) {
    signals.push('low draw rate and likely winner-seeking behavior');
    return { archetype: 'favorite_chaser', confidence: round(Math.min(confidenceCap, 0.55)), signals };
  }

  signals.push('insufficient distinctive evidence');
  return { archetype: 'unknown', confidence: round(Math.min(confidenceCap, 0.2)), signals };
}

function scoreTendenciesFromBets(bets: IndexerBet[]): OpponentProfile['scoreTendencies'] {
  const total = bets.length;
  if (total === 0) {
    return {
      exactScoreHitRate: null,
      outcomeHitRate: null,
      drawPickRate: 0,
      homePickRate: 0,
      awayPickRate: 0,
      averageTotalGoalsPicked: null,
      averageGoalMarginPicked: null,
      commonScorePickRate: 0,
      highVarianceScorePickRate: 0,
      topPickedScores: [],
    };
  }

  let home = 0;
  let draw = 0;
  let away = 0;
  let common = 0;
  let highVariance = 0;
  let totalGoals = 0;
  let totalMargin = 0;
  let finalized = 0;
  let exactHits = 0;
  let outcomeHits = 0;
  const counts = new Map<string, { score: Score; count: number }>();

  for (const bet of bets) {
    const score = { home: bet.scoreHome, away: bet.scoreAway };
    const outcome = scoreOutcome(score);
    if (outcome === 'home') home += 1;
    if (outcome === 'draw') draw += 1;
    if (outcome === 'away') away += 1;
    const key = scoreKey(score);
    if (COMMON_SCORE_KEYS.has(key)) common += 1;
    if (score.home + score.away >= 5 || Math.abs(score.home - score.away) >= 3) highVariance += 1;
    totalGoals += score.home + score.away;
    totalMargin += Math.abs(score.home - score.away);
    counts.set(key, { score, count: (counts.get(key)?.count ?? 0) + 1 });

    if (bet.matchRef?.status === 'FINALIZED' && bet.matchRef.scoreHome !== null && bet.matchRef.scoreAway !== null) {
      finalized += 1;
      const resultScore = { home: bet.matchRef.scoreHome, away: bet.matchRef.scoreAway };
      if (resultScore.home === score.home && resultScore.away === score.away) exactHits += 1;
      if (scoreOutcome(resultScore) === outcome) outcomeHits += 1;
    }
  }

  return {
    exactScoreHitRate: finalized > 0 ? round(exactHits / finalized) : null,
    outcomeHitRate: finalized > 0 ? round(outcomeHits / finalized) : null,
    drawPickRate: round(draw / total),
    homePickRate: round(home / total),
    awayPickRate: round(away / total),
    averageTotalGoalsPicked: round(totalGoals / total),
    averageGoalMarginPicked: round(totalMargin / total),
    commonScorePickRate: round(common / total),
    highVarianceScorePickRate: round(highVariance / total),
    topPickedScores: [...counts.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 5)
      .map((entry) => ({ score: entry.score, count: entry.count, rate: round(entry.count / total) })),
  };
}

function stakeProfileFromBets(bets: IndexerBet[]): OpponentProfile['stake'] {
  const stakes = bets.map((bet) => toBigIntOrNull(bet.stakeRaw)).filter((value): value is bigint => value !== null);
  if (stakes.length === 0) {
    return {
      averageStakePlanck: null,
      medianStakePlanck: null,
      maxStakePlanck: null,
      stakeVolatility: null,
      stakeTrend: 'unknown',
    };
  }

  const sorted = [...stakes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const total = stakes.reduce((sum, stake) => sum + stake, 0n);
  const average = total / BigInt(stakes.length);
  const median = sorted[Math.floor(sorted.length / 2)] ?? average;
  const max = sorted[sorted.length - 1] ?? average;

  return {
    averageStakePlanck: average.toString() as U128String,
    medianStakePlanck: median.toString() as U128String,
    maxStakePlanck: max.toString() as U128String,
    stakeVolatility: stakeVolatility(stakes, Number(average)),
    stakeTrend: 'unknown',
  };
}

function rankUserPoints(userPoints: UserPointsEntry[]): Map<string, { rank: number; topOne: number; topThree: number | null; topFive: number | null; sixth: number | null }> {
  const sorted = [...userPoints].sort((left, right) => right.points - left.points);
  const topOne = sorted[0]?.points ?? 0;
  const topThree = sorted[2]?.points ?? null;
  const topFive = sorted[4]?.points ?? null;
  const sixth = sorted[5]?.points ?? null;
  const ranks = new Map<string, { rank: number; topOne: number; topThree: number | null; topFive: number | null; sixth: number | null }>();
  sorted.forEach((entry, index) => {
    ranks.set(normalizeWallet(entry.actor_id), { rank: index + 1, topOne, topThree, topFive, sixth });
  });
  return ranks;
}

function ensureWallet(map: Map<string, WalletAccumulator>, wallet: ActorId | string): WalletAccumulator {
  const key = normalizeWallet(wallet);
  const existing = map.get(key);
  if (existing) return existing;
  const created: WalletAccumulator = {
    wallet,
    displayName: null,
    currentPoints: 0,
    apiMatchesCount: null,
    bets: [],
    userStat: null,
    sources: [],
  };
  map.set(key, created);
  return created;
}

function addSource(acc: WalletAccumulator, source: OpponentProfile['dataSources'][number]): void {
  if (!acc.sources.includes(source)) acc.sources.push(source);
}

function averageLeadTimeMinutes(bets: IndexerBet[]): number | null {
  const leadTimes = bets
    .map((bet) => {
      if (!bet.matchRef) return null;
      const kickoff = Number(bet.matchRef.kickOff);
      const submitted = Date.parse(bet.timestamp);
      if (!Number.isFinite(kickoff) || !Number.isFinite(submitted)) return null;
      return (kickoff - submitted) / 60_000;
    })
    .filter((value): value is number => value !== null);
  if (leadTimes.length === 0) return null;
  return round(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length);
}

function pressureMode(rank: number | null, points: number, participationRate: number): OpponentProfile['rankPressure']['pressureMode'] {
  if (participationRate === 0) return 'inactive';
  if (rank === null) return 'unknown';
  if (rank === 1) return 'leader';
  if (rank <= 5) return 'top_five';
  if (rank <= 8) return 'bubble';
  if (points > 0) return 'chasing';
  return 'unknown';
}

function sampleWarnings(predictionsObserved: number, sources: OpponentProfile['dataSources']): string[] {
  const warnings: string[] = [];
  if (predictionsObserved === 0) warnings.push('No historical bets found for this wallet yet.');
  if (!sources.includes('indexer')) warnings.push('Bet-history features are limited until indexer reads are available.');
  return warnings;
}

function sampleQualityScore(predictionsObserved: number, sourceCount: number): number {
  const historyScore = Math.min(0.7, predictionsObserved / 20);
  const sourceScore = Math.min(0.3, sourceCount * 0.1);
  return round(historyScore + sourceScore);
}

function stakeVolatility(stakes: bigint[], average: number): number | null {
  if (stakes.length < 2 || average <= 0) return null;
  const variance = stakes.reduce((sum, stake) => {
    const diff = Number(stake) - average;
    return sum + diff * diff;
  }, 0) / stakes.length;
  return round(Math.sqrt(variance) / average);
}

function scoreOutcome(score: Score): 'home' | 'draw' | 'away' {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function normalizeWallet(wallet: ActorId | string): string {
  return String(wallet).toLowerCase();
}

function toBigIntOrNull(value: U128String): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
