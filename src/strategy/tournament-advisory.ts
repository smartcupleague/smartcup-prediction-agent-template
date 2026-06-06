import type {
  AgentConfig,
  MatchEligibilityView,
  RiskMode,
  StoredPrediction,
  StoredTelegramPreference,
  StoredTransactionPlan,
  StrategyPosture,
  TournamentAdvisoryPriorityMatch,
  TournamentAdvisoryReport,
  TournamentProfile,
  U128String,
} from '../types/index.js';
import type { EligibleMatchPlanReport } from '../adapters/eligible-match-plan.js';

export type BuildTournamentAdvisoryInput = {
  config: AgentConfig;
  profile: TournamentProfile;
  eligibleMatchPlan: EligibleMatchPlanReport;
  predictions: StoredPrediction[];
  transactionPlans: StoredTransactionPlan[];
  preference?: Pick<StoredTelegramPreference, 'defaultRiskMode' | 'simulationObjective' | 'strategyPosture'> | null;
  generatedAt?: string;
  pillar?: TournamentAdvisoryReport['pillar'];
  priorityLimit?: number;
};

export function buildPersonalTournamentAdvisoryReport(
  input: BuildTournamentAdvisoryInput,
): TournamentAdvisoryReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const pillar = input.pillar ?? 'personal_operator';
  const riskMode = input.preference?.defaultRiskMode ?? input.profile.defaultRiskMode;
  const objective = input.preference?.simulationObjective ?? riskMode;
  const strategyPosture = input.preference?.strategyPosture ?? riskMode;
  const eligible = input.eligibleMatchPlan.plan.eligibleMatches;
  const priorityMatches = rankPriorityMatches(eligible, input.priorityLimit ?? 5);
  const currentPhase = priorityMatches[0]?.phase ?? inferCurrentPhase(input.profile, generatedAt);
  const storedOpenPlanExposurePlanck = sumStoredOpenExposure(input.transactionPlans, input.config.wallet.hexAddress);
  const walletPredictions = input.predictions.filter(
    (prediction) => prediction.walletAddress.toLowerCase() === input.config.wallet.hexAddress.toLowerCase(),
  );
  const livePredictionCount = input.eligibleMatchPlan.sources.mergedBetCount;
  const localPredictionCount = walletPredictions.length;
  const existingPredictionCount = Math.max(livePredictionCount, localPredictionCount);
  const existingPredictionCountSource =
    livePredictionCount > 0
      ? 'live merged chain/indexer/local bet reads'
      : localPredictionCount > 0
        ? 'local memory prediction records'
        : 'no wallet predictions found in live reads or local memory';
  const existingStakeInMatchPoolsPlanck =
    BigInt(input.eligibleMatchPlan.sources.mergedStakeInMatchPoolsPlanck || '0') > 0n
      ? input.eligibleMatchPlan.sources.mergedStakeInMatchPoolsPlanck
      : sumStoredPredictionStake(walletPredictions, 'matchPoolAmountPlanck');
  const existingFreebetPrincipalPlanck =
    BigInt(input.eligibleMatchPlan.sources.mergedFreebetPrincipalPlanck || '0') > 0n
      ? input.eligibleMatchPlan.sources.mergedFreebetPrincipalPlanck
      : '0';

  return {
    schemaVersion: 'smartpredictor.tournament_advisory_report.v1',
    id: `tournament-advisory-${input.profile.tournamentId}-${Date.parse(generatedAt)}`,
    generatedAt,
    product: 'tournament_advisory',
    pillar,
    tournament: {
      id: input.profile.tournamentId,
      name: input.profile.name,
      season: input.profile.season,
      timezone: input.profile.timezone,
    },
    wallet: {
      accountName: input.config.wallet.accountName,
      address: input.config.wallet.hexAddress,
    },
    rollingPlan: {
      reviewCadence: buildReviewCadence(currentPhase, priorityMatches),
      currentPhase,
      openEligibleMatches: eligible.length,
      phaseFocus: buildPhaseFocus(input.profile, currentPhase),
    },
    priorityMatches,
    riskPosture: {
      defaultRiskMode: riskMode,
      strategyPosture,
      rationale: buildRiskRationale(riskMode, strategyPosture, eligible.length),
    },
    leaderboardObjective: {
      objective,
      label: leaderboardObjectiveLabel(objective),
      rationale: buildLeaderboardRationale(objective, priorityMatches),
    },
    stakeExposure: {
      minStakeUsd: input.config.policy.minStakeUsd,
      maxStakeUsd: input.config.policy.maxStakeUsd,
      maxStakePlanck: input.config.policy.maxStakePlanck,
      maxTournamentExposureUsd: input.config.policy.maxTournamentExposureUsd,
      maxTournamentExposurePlanck: input.config.policy.maxTournamentExposurePlanck,
      existingPredictionCount,
      existingPredictionCountSource,
      existingStakeInMatchPoolsPlanck,
      existingFreebetPrincipalPlanck,
      storedOpenPlanExposurePlanck,
      notes: buildStakeExposureNotes(input.config, storedOpenPlanExposurePlanck, {
        existingPredictionCount,
        existingPredictionCountSource,
        existingStakeInMatchPoolsPlanck,
        existingFreebetPrincipalPlanck,
      }),
    },
    nextActions: buildNextActions(priorityMatches, riskMode, objective),
    sourceWarnings: input.eligibleMatchPlan.warnings,
    notes: [
      'Personal tournament advisory is read-only and does not create an external-service request.',
      'Use match-specific previews before approving any wallet transaction.',
      'Stake and exposure values are policy context; live execution still runs duplicate, cutoff, balance, exposure, and approval guards.',
    ],
    payload: {
      eligibleMatchPlanSources: input.eligibleMatchPlan.sources,
      cutoff: input.eligibleMatchPlan.plan.cutoff,
      totalMatches: input.eligibleMatchPlan.plan.totalMatches,
      ineligibleCount: input.eligibleMatchPlan.plan.ineligibleMatches.length,
      walletBetSources: input.eligibleMatchPlan.sources,
      preference: input.preference ?? null,
    },
  };
}

export function renderTournamentAdvisorySummary(report: TournamentAdvisoryReport): string {
  return [
    'Personal tournament advisory',
    `Tournament: ${report.tournament.name}`,
    `Tournament ID: ${report.tournament.id}`,
    `Generated: ${report.generatedAt}`,
    `Wallet: ${report.wallet.accountName} (${shortAddress(report.wallet.address)})`,
    '',
    'Rolling plan:',
    `Review cadence: ${report.rollingPlan.reviewCadence}`,
    `Current phase focus: ${report.rollingPlan.currentPhase ?? 'not available'}`,
    `Eligible open matches: ${report.rollingPlan.openEligibleMatches}`,
    ...report.rollingPlan.phaseFocus.map((line) => `- ${line}`),
    '',
    'Priority matches:',
    ...(report.priorityMatches.length
      ? report.priorityMatches.map(
          (match, index) =>
            `${index + 1}. #${match.matchId} ${match.label} | ${match.phase} x${match.phaseWeight ?? '?'} | closes ${match.safetyCloseAt} | priority ${match.priorityScore}`,
        )
      : ['No eligible open matches found.']),
    '',
    'Risk posture:',
    `Default risk: ${report.riskPosture.defaultRiskMode}`,
    `Strategy posture: ${report.riskPosture.strategyPosture}`,
    ...report.riskPosture.rationale.map((line) => `- ${line}`),
    '',
    'Leaderboard objective:',
    `${report.leaderboardObjective.objective}: ${report.leaderboardObjective.label}`,
    ...report.leaderboardObjective.rationale.map((line) => `- ${line}`),
    '',
    'Stake and exposure context:',
    `Minimum stake USD: ${report.stakeExposure.minStakeUsd ?? 'not configured'}`,
    `Max stake USD: ${report.stakeExposure.maxStakeUsd ?? 'not configured'}`,
    `Max stake planck: ${report.stakeExposure.maxStakePlanck}`,
    `Max tournament exposure USD: ${report.stakeExposure.maxTournamentExposureUsd ?? 'not configured'}`,
    `Max tournament exposure planck: ${report.stakeExposure.maxTournamentExposurePlanck}`,
    `Existing predictions: ${report.stakeExposure.existingPredictionCount} (${report.stakeExposure.existingPredictionCountSource})`,
    `Already submitted match-pool stake: ${report.stakeExposure.existingStakeInMatchPoolsPlanck} planck`,
    `Existing freebet principal: ${report.stakeExposure.existingFreebetPrincipalPlanck} planck`,
    `Pending unsubmitted plan exposure: ${report.stakeExposure.storedOpenPlanExposurePlanck} planck`,
    ...report.stakeExposure.notes.map((line) => `- ${line}`),
    '',
    'Next actions:',
    ...report.nextActions.map((line, index) => `${index + 1}. ${line}`),
    report.sourceWarnings.length ? ['', 'Source warnings:', ...report.sourceWarnings.map((line) => `- ${line}`)].join('\n') : null,
    '',
    ...report.notes.map((line) => `Note: ${line}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function rankPriorityMatches(
  matches: MatchEligibilityView[],
  limit: number,
): TournamentAdvisoryPriorityMatch[] {
  return matches
    .map((match) => {
      const hoursUntilSafetyClose = round2(match.timeUntilSafetyCloseMs / 3_600_000);
      const urgencyScore = Math.max(0, 100 - Math.max(0, hoursUntilSafetyClose));
      const phaseScore = (match.phaseWeight ?? 1) * 12;
      const priorityScore = round2(urgencyScore + phaseScore);
      return {
        matchId: match.matchId,
        label: `${match.home} vs ${match.away}`,
        phase: match.phase,
        phaseWeight: match.phaseWeight,
        kickOffAt: new Date(match.kickOffMs).toISOString(),
        safetyCloseAt: new Date(match.agentSafetyCloseMs).toISOString(),
        hoursUntilSafetyClose,
        priorityScore,
        rationale: [
          `Safety cutoff is ${hoursUntilSafetyClose} hour(s) away.`,
          `Phase multiplier is x${match.phaseWeight ?? '?'}.`,
          'Eligible for the connected wallet under current duplicate/status/cutoff filters.',
        ],
      };
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, limit);
}

function buildReviewCadence(
  currentPhase: string | null,
  priorityMatches: TournamentAdvisoryPriorityMatch[],
): string {
  const first = priorityMatches[0] ?? null;
  if (!first) return 'Daily until new eligible matches appear, then before every match safety cutoff.';
  if (first.hoursUntilSafetyClose <= 12) return 'Every 2-4 hours while the next safety cutoff is inside 12 hours.';
  if (first.hoursUntilSafetyClose <= 36) return 'Twice daily until the next priority match is decided.';
  return currentPhase?.toLowerCase().includes('group')
    ? 'Daily during group stage, with extra review after lineup/news changes.'
    : 'Twice daily during knockout phases and immediately after each bracket result.';
}

function inferCurrentPhase(profile: TournamentProfile, generatedAt: string): string | null {
  const now = Date.parse(generatedAt);
  const active = profile.phases.find((phase) => {
    const start = phase.startsAt ? Date.parse(phase.startsAt) : NaN;
    const end = phase.endsAt ? Date.parse(phase.endsAt) : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
  return active?.name ?? profile.phases[0]?.name ?? null;
}

function buildPhaseFocus(profile: TournamentProfile, currentPhase: string | null): string[] {
  const phase = currentPhase
    ? profile.phases.find((entry) => entry.name === currentPhase || entry.smartcupPhaseNames.includes(currentPhase))
    : null;
  return [
    phase ? `Current configured phase weight is x${phase.pointsWeight}.` : 'Current phase is inferred from match availability.',
    `Prediction cutoff is ${profile.cutoff.predictionCutoffMinutes} minutes before kickoff plus agent safety buffer ${profile.cutoff.safetyBufferMs}ms.`,
    'Prioritize matches that are eligible, close to safety cutoff, and carry higher phase multipliers.',
  ];
}

function buildRiskRationale(riskMode: RiskMode, strategyPosture: StrategyPosture, eligibleCount: number): string[] {
  return [
    `Use ${riskMode} as the default match recommendation mode unless a command overrides it.`,
    `Use ${strategyPosture} as the broader tournament posture for selecting conservative versus swing spots.`,
    eligibleCount > 5
      ? 'There are enough open matches to separate safe point accumulation from contrarian swing attempts.'
      : 'Few eligible matches are open, so avoid forcing risk unless leaderboard position requires it.',
  ];
}

function buildLeaderboardRationale(
  objective: RiskMode,
  priorityMatches: TournamentAdvisoryPriorityMatch[],
): string[] {
  return [
    `Simulation objective defaults to ${objective}.`,
    priorityMatches.some((match) => (match.phaseWeight ?? 1) >= 3)
      ? 'At least one priority match carries elevated phase weight, so leaderboard impact can outweigh payout EV.'
      : 'Current priority matches are lower phase weight, so accumulate points and avoid unnecessary variance.',
    'Run competitor/leaderboard analysis before approving high-impact or contrarian choices.',
  ];
}

function leaderboardObjectiveLabel(objective: RiskMode): string {
  if (objective === 'catch_up') return 'maximize upside when trailing the target rank.';
  if (objective === 'protect_lead') return 'reduce downside and preserve current rank edge.';
  if (objective === 'final_swing') return 'favor high-leverage late-tournament separation.';
  if (objective === 'contrarian') return 'seek differentiated picks when crowding is visible.';
  if (objective === 'conservative') return 'prefer higher-confidence point accumulation.';
  return 'balance payout EV, points EV, and opponent-aware leaderboard equity.';
}

function buildStakeExposureNotes(
  config: AgentConfig,
  storedOpenPlanExposurePlanck: string,
  existing: {
    existingPredictionCount: number;
    existingPredictionCountSource: string;
    existingStakeInMatchPoolsPlanck: U128String;
    existingFreebetPrincipalPlanck: U128String;
  },
): string[] {
  return [
    config.policy.minStakeUsd
      ? `Minimum stake is configured in USD (${config.policy.minStakeUsd}) and converted through the SmartCup price path at execution time.`
      : 'Minimum stake USD is not configured.',
    config.policy.maxStakeUsd
      ? `Max stake is configured in USD (${config.policy.maxStakeUsd}); raw planck cap remains visible for audit.`
      : 'Max stake USD is not configured; raw planck cap is used.',
    config.policy.maxTournamentExposureUsd
      ? `Max tournament exposure is configured in USD (${config.policy.maxTournamentExposureUsd}); execution guard converts it before submission.`
      : 'Max tournament exposure USD is not configured; raw planck cap is used.',
    `Existing prediction count source: ${existing.existingPredictionCountSource}.`,
    existing.existingPredictionCount > 0
      ? `Already submitted wallet predictions are included as tournament context (${existing.existingPredictionCount} found).`
      : 'No submitted wallet predictions were found in current reads; refresh/sync if this looks wrong.',
    BigInt(existing.existingStakeInMatchPoolsPlanck || '0') > 0n
      ? 'Already submitted match-pool stake is separated from pending unsubmitted plan exposure.'
      : 'No already submitted match-pool stake was found in the current wallet bet reads.',
    BigInt(existing.existingFreebetPrincipalPlanck || '0') > 0n
      ? 'Existing freebet principal is shown separately from cash stake.'
      : null,
    BigInt(storedOpenPlanExposurePlanck || '0') > 0n
      ? 'There are stored open value-bearing plans; review them before approving new exposure.'
      : 'No stored open value-bearing transaction plan exposure is currently counted in local memory.',
  ].filter((note): note is string => note !== null);
}

function buildNextActions(
  priorityMatches: TournamentAdvisoryPriorityMatch[],
  riskMode: RiskMode,
  objective: RiskMode,
): string[] {
  const first = priorityMatches[0] ?? null;
  const actions = [
    first
      ? `Generate a decision preview for priority match #${first.matchId} using risk ${riskMode}.`
      : 'Wait for eligible matches or refresh the eligible-match plan.',
    first ? `Run competitor/leaderboard analysis for match #${first.matchId} with objective ${objective}.` : null,
    'Review stake/exposure policy before any approval.',
    'Approve a saved DecisionReport only after duplicate, cutoff, balance, exposure, and policy guards pass.',
    'Refresh this advisory after new results, phase registration, odds/news updates, or leaderboard movement.',
  ];
  return actions.filter((action): action is string => action !== null);
}

function sumStoredOpenExposure(plans: StoredTransactionPlan[], wallet: string): string {
  const total = plans.reduce((sum, plan) => {
    if (plan.wallet.toLowerCase() !== wallet.toLowerCase()) return sum;
    if (plan.kind !== 'PlaceBet' && plan.kind !== 'SubmitPodiumPick') return sum;
    if (plan.status === 'blocked' || plan.status === 'failed' || plan.status === 'cancelled') return sum;
    return sum + BigInt(plan.valuePlanck || '0');
  }, 0n);
  return total.toString();
}

function sumStoredPredictionStake(
  predictions: StoredPrediction[],
  field: 'amountPlanck' | 'matchPoolAmountPlanck',
): U128String {
  return predictions
    .reduce((sum, prediction) => sum + BigInt(prediction[field] || '0'), 0n)
    .toString() as U128String;
}

function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
