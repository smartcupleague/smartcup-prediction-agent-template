import type {
  ActorId,
  IoSmartCupState,
  PoolOutcome,
  RiskMode,
  RiskModeEvaluationReport,
  OpponentProfile,
  Score,
  TournamentPositionPosture,
  TournamentPositionStrategyReport,
  TournamentPositionStrategySignal,
  UserPointsEntry,
} from '../types/index.js';

export type TournamentPositionStrategyInput = {
  matchId: string;
  wallet: ActorId;
  state: IoSmartCupState;
  phase: string;
  phaseWeight: number;
  selectedScore: Score;
  selectedOutcome: PoolOutcome;
  selectedConfidence: number;
  risk: RiskModeEvaluationReport;
  opponentProfiles?: OpponentProfile[];
};

type RankedWallet = {
  actor_id: ActorId | string;
  points: number;
  rank: number;
  source: PositionSnapshot['source'];
};

type PositionSnapshot = {
  source: 'chain_user_points' | 'profile_leaderboard_fallback' | 'none';
  rows: RankedWallet[];
  current: RankedWallet | null;
  leader: RankedWallet | null;
  previous: RankedWallet | null;
  next: RankedWallet | null;
  fifth: RankedWallet | null;
  sixth: RankedWallet | null;
};

export class TournamentPositionStrategyModel {
  buildReport(input: TournamentPositionStrategyInput): TournamentPositionStrategyReport {
    const generatedAt = new Date().toISOString();
    const snapshot = buildSnapshot(input.state.user_points, input.wallet, input.opponentProfiles ?? []);
    const currentPoints = snapshot.current?.points ?? 0;
    const pointsBehindLeader = snapshot.leader && snapshot.current ? Math.max(0, snapshot.leader.points - currentPoints) : null;
    const pointsBehindNextRank = snapshot.previous && snapshot.current ? Math.max(0, snapshot.previous.points - currentPoints) : null;
    const pointsAheadNextRank = snapshot.next && snapshot.current ? Math.max(0, currentPoints - snapshot.next.points) : null;
    const pointsBehindTopFive = snapshot.fifth && snapshot.current ? Math.max(0, snapshot.fifth.points - currentPoints) : null;
    const pointsAheadSixth = snapshot.sixth && snapshot.current ? Math.max(0, currentPoints - snapshot.sixth.points) : null;
    const signals = buildSignals({
      snapshot,
      currentPoints,
      pointsBehindLeader,
      pointsBehindNextRank,
      pointsAheadNextRank,
      pointsBehindTopFive,
      pointsAheadSixth,
      phaseWeight: input.phaseWeight,
      selectedConfidence: input.selectedConfidence,
      riskMode: input.risk.riskMode,
    });
    const selectedPosture = choosePosture(signals, snapshot, input.phaseWeight, pointsBehindLeader, pointsBehindTopFive);
    const recommendedRiskMode = riskModeForPosture(selectedPosture);
    const recommendedObjective = objectiveForPosture(selectedPosture);
    const warnings = buildWarnings(snapshot);

    return {
      matchId: input.matchId,
      generatedAt,
      model: 'tournament_position_strategy_v1',
      wallet: input.wallet,
      rankingSource: snapshot.source,
      currentRank: snapshot.current?.rank ?? null,
      currentPoints,
      totalRankedWallets: snapshot.rows.length,
      pointsBehindLeader,
      pointsBehindNextRank,
      pointsAheadNextRank,
      pointsBehindTopFive,
      pointsAheadSixth,
      selectedPosture,
      recommendedRiskMode,
      recommendedObjective,
      recommendation: recommendationForPosture(selectedPosture, recommendedRiskMode, recommendedObjective),
      confidence: confidenceFor(snapshot, signals),
      phase: input.phase,
      phaseWeight: input.phaseWeight,
      signals,
      rationale: buildRationale({
        selectedPosture,
        recommendedRiskMode,
        recommendedObjective,
        currentRank: snapshot.current?.rank ?? null,
        totalRankedWallets: snapshot.rows.length,
        pointsBehindLeader,
        pointsBehindNextRank,
        pointsAheadNextRank,
        pointsBehindTopFive,
        pointsAheadSixth,
        phaseWeight: input.phaseWeight,
        selectedScore: input.selectedScore,
        selectedOutcome: input.selectedOutcome,
        selectedConfidence: input.selectedConfidence,
        activeRiskMode: input.risk.riskMode,
      }),
      warnings,
    };
  }
}

function buildSnapshot(
  userPoints: UserPointsEntry[],
  wallet: ActorId,
  opponentProfiles: OpponentProfile[],
): PositionSnapshot {
  const chainRows = [...userPoints]
    .sort((left, right) => {
      const pointDiff = right.points - left.points;
      if (pointDiff !== 0) return pointDiff;
      return left.actor_id.localeCompare(right.actor_id);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1, source: 'chain_user_points' as const }));
  const rows = chainRows.length > 0 ? chainRows : buildFallbackRows(opponentProfiles);
  const index = rows.findIndex((entry) => entry.actor_id.toLowerCase() === wallet.toLowerCase());
  const current = index >= 0 ? rows[index] ?? null : null;
  return {
    source: chainRows.length > 0 ? 'chain_user_points' : rows.length > 0 ? 'profile_leaderboard_fallback' : 'none',
    rows,
    current,
    leader: rows[0] ?? null,
    previous: index > 0 ? rows[index - 1] ?? null : null,
    next: index >= 0 ? rows[index + 1] ?? null : null,
    fifth: rows[4] ?? null,
    sixth: rows[5] ?? null,
  };
}

function buildFallbackRows(opponentProfiles: OpponentProfile[]): RankedWallet[] {
  return opponentProfiles
    .filter((profile) => profile.dataSources.includes('smartcup_api') || profile.dataSources.includes('indexer'))
    .sort((left, right) => {
      const pointDiff = right.rankPressure.currentPoints - left.rankPressure.currentPoints;
      if (pointDiff !== 0) return pointDiff;
      const predictionDiff = right.participation.predictionsObserved - left.participation.predictionsObserved;
      if (predictionDiff !== 0) return predictionDiff;
      return String(left.displayName ?? left.wallet).localeCompare(String(right.displayName ?? right.wallet));
    })
    .map((profile, index) => ({
      actor_id: profile.wallet,
      points: profile.rankPressure.currentPoints,
      rank: index + 1,
      source: 'profile_leaderboard_fallback' as const,
    }));
}

function buildSignals(input: {
  snapshot: PositionSnapshot;
  currentPoints: number;
  pointsBehindLeader: number | null;
  pointsBehindNextRank: number | null;
  pointsAheadNextRank: number | null;
  pointsBehindTopFive: number | null;
  pointsAheadSixth: number | null;
  phaseWeight: number;
  selectedConfidence: number;
  riskMode: RiskMode;
}): TournamentPositionStrategySignal[] {
  return [
    rankPositionSignal(input.snapshot),
    leaderGapSignal(input.snapshot.source, input.pointsBehindLeader),
    nextRankGapSignal(input.pointsBehindNextRank, input.pointsAheadNextRank),
    topFiveGapSignal(input.snapshot, input.pointsBehindTopFive, input.pointsAheadSixth),
    phaseLeverageSignal(input.phaseWeight),
    selectedPickFitSignal(input.selectedConfidence, input.riskMode),
  ];
}

function rankPositionSignal(snapshot: PositionSnapshot): TournamentPositionStrategySignal {
  if (!snapshot.current) {
    return signal('rank_position', 'Rank position', 'mid_table', 'medium', 'Wallet is not currently ranked in the available leaderboard rows.');
  }
  if (snapshot.source === 'profile_leaderboard_fallback') {
    return signal(
      'rank_position',
      'Rank position',
      'mid_table',
      'medium',
      `Wallet appears in the SmartCup profile leaderboard at provisional row #${snapshot.current.rank}, but chain user_points is empty.`,
    );
  }
  if (snapshot.current.rank === 1) {
    return signal('rank_position', 'Rank position', 'leading', 'high', 'Wallet is currently leading the visible leaderboard.');
  }
  if (snapshot.current.rank <= 5) {
    return signal('rank_position', 'Rank position', 'mid_table', 'medium', `Wallet is inside the visible top five at rank #${snapshot.current.rank}.`);
  }
  return signal('rank_position', 'Rank position', 'catch_up', 'high', `Wallet is outside top five at rank #${snapshot.current.rank}.`);
}

function leaderGapSignal(
  source: PositionSnapshot['source'],
  pointsBehindLeader: number | null,
): TournamentPositionStrategySignal {
  if (source !== 'chain_user_points') {
    return signal('leader_gap', 'Leader gap', 'mid_table', 'low', 'Leader gap is provisional until chain user_points is populated.');
  }
  if (pointsBehindLeader === null) {
    return signal('leader_gap', 'Leader gap', 'mid_table', 'low', 'Leader gap is unavailable.');
  }
  if (pointsBehindLeader === 0) {
    return signal('leader_gap', 'Leader gap', 'leading', 'high', 'Wallet is tied with or ahead of the leader gap calculation.');
  }
  if (pointsBehindLeader <= 2) {
    return signal('leader_gap', 'Leader gap', 'mid_table', 'medium', `${pointsBehindLeader} point(s) behind the leader; balanced pressure.`);
  }
  if (pointsBehindLeader <= 8) {
    return signal('leader_gap', 'Leader gap', 'catch_up', 'medium', `${pointsBehindLeader} point(s) behind the leader; upside matters.`);
  }
  return signal('leader_gap', 'Leader gap', 'final_swing', 'high', `${pointsBehindLeader} point(s) behind the leader; high-upside strategy is justified.`);
}

function nextRankGapSignal(
  pointsBehindNextRank: number | null,
  pointsAheadNextRank: number | null,
): TournamentPositionStrategySignal {
  if (pointsBehindNextRank === null && pointsAheadNextRank === null) {
    return signal('next_rank_gap', 'Adjacent rank gap', 'mid_table', 'low', 'Adjacent rank gap is unavailable.');
  }
  if ((pointsBehindNextRank === null || pointsBehindNextRank === 0) && pointsAheadNextRank !== null) {
    if (pointsAheadNextRank >= 3) {
      return signal('next_rank_gap', 'Adjacent rank gap', 'leading', 'medium', `${pointsAheadNextRank} point(s) ahead of the next competitor.`);
    }
    return signal('next_rank_gap', 'Adjacent rank gap', 'mid_table', 'medium', `${pointsAheadNextRank} point(s) ahead of the next competitor; lead is thin.`);
  }
  if ((pointsBehindNextRank ?? 0) <= 2) {
    return signal('next_rank_gap', 'Adjacent rank gap', 'mid_table', 'medium', `${pointsBehindNextRank} point(s) behind the next rank.`);
  }
  return signal('next_rank_gap', 'Adjacent rank gap', 'catch_up', 'medium', `${pointsBehindNextRank} point(s) behind the next rank.`);
}

function topFiveGapSignal(
  snapshot: PositionSnapshot,
  pointsBehindTopFive: number | null,
  pointsAheadSixth: number | null,
): TournamentPositionStrategySignal {
  if (!snapshot.current) {
    return signal('top_five_gap', 'Top-five gap', 'mid_table', 'low', 'Top-five gap is unavailable because wallet is not ranked.');
  }
  if (snapshot.current.rank <= 5) {
    if (pointsAheadSixth !== null && pointsAheadSixth >= 4) {
      return signal('top_five_gap', 'Top-five gap', 'leading', 'medium', `${pointsAheadSixth} point(s) ahead of sixth; protect final-prize equity.`);
    }
    return signal('top_five_gap', 'Top-five gap', 'mid_table', 'medium', 'Wallet is top five, but the gap to sixth is thin or unavailable.');
  }
  if (pointsBehindTopFive !== null && pointsBehindTopFive <= 3) {
    return signal('top_five_gap', 'Top-five gap', 'catch_up', 'high', `${pointsBehindTopFive} point(s) behind fifth; catch-up picks can move rank.`);
  }
  return signal('top_five_gap', 'Top-five gap', 'final_swing', 'high', `${pointsBehindTopFive ?? 'unknown'} point(s) behind fifth; differentiated upside matters.`);
}

function phaseLeverageSignal(phaseWeight: number): TournamentPositionStrategySignal {
  if (phaseWeight >= 5) {
    return signal('phase_leverage', 'Phase leverage', 'final_swing', 'high', `Phase weight is x${phaseWeight}; one pick can materially change rank.`);
  }
  if (phaseWeight >= 3) {
    return signal('phase_leverage', 'Phase leverage', 'catch_up', 'medium', `Phase weight is x${phaseWeight}; rank movement is meaningful.`);
  }
  return signal('phase_leverage', 'Phase leverage', 'mid_table', 'low', `Phase weight is x${phaseWeight}; avoid overreacting to early-table noise.`);
}

function selectedPickFitSignal(selectedConfidence: number, riskMode: RiskMode): TournamentPositionStrategySignal {
  if (riskMode === 'protect_lead' || riskMode === 'conservative') {
    return signal('selected_pick_fit', 'Selected pick fit', 'leading', 'medium', `Active risk mode ${riskMode} already favors rank protection.`);
  }
  if (riskMode === 'catch_up' || riskMode === 'contrarian' || riskMode === 'final_swing') {
    return signal('selected_pick_fit', 'Selected pick fit', riskMode === 'final_swing' ? 'final_swing' : 'catch_up', 'medium', `Active risk mode ${riskMode} already favors upside.`);
  }
  if (selectedConfidence >= 0.7) {
    return signal('selected_pick_fit', 'Selected pick fit', 'leading', 'low', `Selected pick confidence is ${round(selectedConfidence)}; safer posture is viable.`);
  }
  return signal('selected_pick_fit', 'Selected pick fit', 'mid_table', 'low', `Selected pick confidence is ${round(selectedConfidence)}; keep posture balanced unless rank gap demands risk.`);
}

function choosePosture(
  signals: TournamentPositionStrategySignal[],
  snapshot: PositionSnapshot,
  phaseWeight: number,
  pointsBehindLeader: number | null,
  pointsBehindTopFive: number | null,
): TournamentPositionPosture {
  if (!snapshot.current) return 'mid_table';
  if (snapshot.source !== 'chain_user_points') return 'mid_table';
  if (phaseWeight >= 5 && ((pointsBehindLeader ?? 0) >= 8 || (snapshot.current.rank > 5 && (pointsBehindTopFive ?? 99) > 3))) {
    return 'final_swing';
  }
  const counts = new Map<TournamentPositionPosture, number>([
    ['leading', 0],
    ['mid_table', 0],
    ['catch_up', 0],
    ['final_swing', 0],
  ]);
  for (const entry of signals) {
    counts.set(entry.posture, (counts.get(entry.posture) ?? 0) + (entry.severity === 'high' ? 3 : entry.severity === 'medium' ? 2 : 1));
  }
  if (snapshot.current.rank === 1 && (counts.get('final_swing') ?? 0) < 3) return 'leading';
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'mid_table';
}

function riskModeForPosture(posture: TournamentPositionPosture): RiskMode {
  if (posture === 'leading') return 'protect_lead';
  if (posture === 'catch_up') return 'catch_up';
  if (posture === 'final_swing') return 'final_swing';
  return 'balanced';
}

function objectiveForPosture(posture: TournamentPositionPosture): RiskMode {
  if (posture === 'leading') return 'protect_lead';
  if (posture === 'catch_up') return 'catch_up';
  if (posture === 'final_swing') return 'final_swing';
  return 'balanced';
}

function recommendationForPosture(
  posture: TournamentPositionPosture,
  riskMode: RiskMode,
  objective: RiskMode,
): string {
  if (posture === 'leading') {
    return `Protect rank equity: use ${riskMode} risk and ${objective} objective unless a candidate has overwhelming points EV.`;
  }
  if (posture === 'catch_up') {
    return `Prioritize rank movement: use ${riskMode} risk and ${objective} objective, especially on higher-weight matches.`;
  }
  if (posture === 'final_swing') {
    return `Take a controlled swing: use ${riskMode} posture and look for differentiated high-upside scores.`;
  }
  return `Stay balanced: use ${riskMode} risk and ${objective} objective until the rank gap becomes clearer.`;
}

function confidenceFor(snapshot: PositionSnapshot, signals: TournamentPositionStrategySignal[]): 'low' | 'medium' | 'high' {
  if (snapshot.source !== 'chain_user_points') return 'low';
  if (!snapshot.current || snapshot.rows.length < 3) return 'low';
  const high = signals.filter((entry) => entry.severity === 'high').length;
  if (snapshot.rows.length >= 8 && high >= 2) return 'high';
  return 'medium';
}

function buildRationale(input: {
  selectedPosture: TournamentPositionPosture;
  recommendedRiskMode: RiskMode;
  recommendedObjective: RiskMode;
  currentRank: number | null;
  totalRankedWallets: number;
  pointsBehindLeader: number | null;
  pointsBehindNextRank: number | null;
  pointsAheadNextRank: number | null;
  pointsBehindTopFive: number | null;
  pointsAheadSixth: number | null;
  phaseWeight: number;
  selectedScore: Score;
  selectedOutcome: PoolOutcome;
  selectedConfidence: number;
  activeRiskMode: RiskMode;
}): string[] {
  return [
    input.currentRank
      ? `Current rank is #${input.currentRank} of ${input.totalRankedWallets}; posture is ${input.selectedPosture}.`
      : `Current rank is unavailable; posture defaults to ${input.selectedPosture} with low confidence.`,
    `Leader gap=${input.pointsBehindLeader ?? 'n/a'}, next-rank gap=${input.pointsBehindNextRank ?? 'n/a'}, cushion=${input.pointsAheadNextRank ?? 'n/a'}, top-five gap=${input.pointsBehindTopFive ?? 'n/a'}, top-five cushion=${input.pointsAheadSixth ?? 'n/a'}.`,
    `Phase weight is x${input.phaseWeight}, so each exact/outcome point has that multiplier in rank movement.`,
    `Recommended settings: risk=${input.recommendedRiskMode}, objective=${input.recommendedObjective}; active risk=${input.activeRiskMode}.`,
    `Selected score ${input.selectedScore.home}-${input.selectedScore.away} (${input.selectedOutcome}) has confidence ${round(input.selectedConfidence)}.`,
  ];
}

function buildWarnings(snapshot: PositionSnapshot): string[] {
  const warnings: string[] = [];
  if (!snapshot.current) warnings.push('Configured wallet is not present in live user_points; rank posture is approximate.');
  if (snapshot.source === 'profile_leaderboard_fallback') {
    warnings.push('Chain user_points is empty; using SmartCup API/profile leaderboard rows as a provisional unscored fallback.');
  }
  if (snapshot.rows.length < 3) warnings.push('Leaderboard sample is tiny; tournament-position posture may be unstable.');
  return warnings;
}

function signal(
  key: TournamentPositionStrategySignal['key'],
  label: string,
  posture: TournamentPositionPosture,
  severity: TournamentPositionStrategySignal['severity'],
  detail: string,
): TournamentPositionStrategySignal {
  return { key, label, posture, severity, detail };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
