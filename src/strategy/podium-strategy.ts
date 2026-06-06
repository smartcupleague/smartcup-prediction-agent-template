import { DEFAULT_TEAM_RATINGS } from '../models/team-rating-model.js';
import type {
  PodiumStrategyPick,
  PodiumStrategyReport,
  PodiumStrategySlate,
  TournamentProfile,
} from '../types/index.js';

export type BuildPodiumStrategyOptions = {
  generatedAt?: string;
  pillar?: PodiumStrategyReport['pillar'];
};

export function buildPersonalPodiumStrategyReport(
  profile: TournamentProfile,
  options: BuildPodiumStrategyOptions = {},
): PodiumStrategyReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const contenders = DEFAULT_TEAM_RATINGS.slice().sort((left, right) => right.rating - left.rating);
  const [championSeed, runnerUpSeed, thirdPlaceSeed, fourthSeed, fifthSeed] = contenders;
  if (!championSeed || !runnerUpSeed || !thirdPlaceSeed || !fourthSeed || !fifthSeed) {
    throw new Error('Podium strategy requires at least five seeded team ratings.');
  }

  const timingWindow = buildTimingWindow(profile, generatedAt);
  const confidence = buildPodiumConfidence({
    timingStatus: timingWindow.status,
    championRating: championSeed.rating,
    fourthRating: fourthSeed.rating,
    sourceWarningCount: timingWindow.enabled ? 0 : 1,
  });

  const recommendation = {
    champion: buildPick('champion', championSeed.team, championSeed.rating, confidence.score, [
      'Highest seeded title candidate in the current operator rating model.',
      'Best all-around path assumption before knockout bracket certainty improves.',
      'Strong enough to be a default pick while still leaving runner-up and third-place slots for high-rated alternatives.',
    ]),
    runnerUp: buildPick('runner_up', runnerUpSeed.team, runnerUpSeed.rating, Math.max(0.1, confidence.score - 0.04), [
      'Second-highest title candidate and natural finalist hedge against the champion pick.',
      'Keeps the slate concentrated around teams most likely to survive a long knockout path.',
      'Useful if the final-prize race rewards avoiding a low-probability podium miss.',
    ]),
    thirdPlace: buildPick('third_place', thirdPlaceSeed.team, thirdPlaceSeed.rating, Math.max(0.1, confidence.score - 0.08), [
      'High seed with credible semi-final path but slightly lower title posture than the top two.',
      'Third-place slot captures a strong team that could rebound from a semi-final loss.',
      'Exact-position scoring favors a plausible bronze-match winner over a pure champion-only ranking.',
    ]),
  };

  const alternatives: PodiumStrategySlate[] = [
    {
      champion: runnerUpSeed.team,
      runnerUp: championSeed.team,
      thirdPlace: fourthSeed.team,
      rationale: [
        'Higher-upside inversion if the market becomes crowded around the default champion.',
        'Keeps two elite teams in the top slots while rotating the bronze pick.',
      ],
    },
    {
      champion: championSeed.team,
      runnerUp: thirdPlaceSeed.team,
      thirdPlace: fifthSeed.team,
      rationale: [
        'Conservative champion hold with more diversification behind it.',
        'Useful if the knockout draw makes the default runner-up path less attractive.',
      ],
    },
  ];

  return {
    schemaVersion: 'smartpredictor.podium_strategy_report.v1',
    id: `podium-${profile.tournamentId}-${Date.parse(generatedAt)}`,
    generatedAt,
    product: 'podium_strategy',
    pillar: options.pillar ?? 'personal_operator',
    tournament: {
      id: profile.tournamentId,
      name: profile.name,
      season: profile.season,
      timezone: profile.timezone,
    },
    timingWindow,
    recommendation,
    alternatives,
    confidence,
    bonusPoints: profile.podiumPick?.bonusPoints ?? null,
    tournamentPathAssumptions: buildTournamentPathAssumptions(profile, [
      championSeed.team,
      runnerUpSeed.team,
      thirdPlaceSeed.team,
      fourthSeed.team,
    ]),
    sourceWarnings: buildPodiumSourceWarnings(profile, timingWindow.status),
    notes: [
      'Personal podium strategy is preview-first and does not submit SubmitPodiumPick by itself.',
      'Telegram approval can build a guarded SubmitPodiumPick plan only after explicit operator approval and final safety checks.',
      'The model is seeded-rating based until full bracket simulation, odds, lineup, and news providers are added.',
    ],
    payload: {
      topSeeds: contenders.slice(0, 8).map((team) => ({
        team: team.team,
        rating: team.rating,
        source: team.source,
        sampleSize: team.sampleSize,
      })),
    },
  };
}

export function renderPodiumStrategySummary(report: PodiumStrategyReport): string {
  return [
    'Personal podium strategy',
    `Tournament: ${report.tournament.name}`,
    `Tournament ID: ${report.tournament.id}`,
    `Generated: ${report.generatedAt}`,
    '',
    'Recommended slate:',
    `Champion: ${report.recommendation.champion.team} (confidence ${formatPercent(report.recommendation.champion.confidence)})`,
    `Runner-up: ${report.recommendation.runnerUp.team} (confidence ${formatPercent(report.recommendation.runnerUp.confidence)})`,
    `Third place: ${report.recommendation.thirdPlace.team} (confidence ${formatPercent(report.recommendation.thirdPlace.confidence)})`,
    `Overall confidence: ${report.confidence.label} (${formatPercent(report.confidence.score)})`,
    '',
    'Timing window:',
    `Status: ${report.timingWindow.status}`,
    report.timingWindow.expectedMatchupDefinedAt
      ? `Expected matchup defined: ${report.timingWindow.expectedMatchupDefinedAt}`
      : 'Expected matchup defined: not configured',
    report.timingWindow.kickoffAt ? `Target kickoff/lock reference: ${report.timingWindow.kickoffAt}` : null,
    report.timingWindow.opportunityWindowHours
      ? `Opportunity window: ${report.timingWindow.opportunityWindowHours.min}-${report.timingWindow.opportunityWindowHours.max} hours`
      : 'Opportunity window: not configured',
    report.timingWindow.hoursUntilExpectedMatchup !== null
      ? `Hours until matchup clarity: ${report.timingWindow.hoursUntilExpectedMatchup}`
      : null,
    report.timingWindow.hoursUntilKickoff !== null ? `Hours until kickoff reference: ${report.timingWindow.hoursUntilKickoff}` : null,
    '',
    'Reasoning:',
    ...report.recommendation.champion.reasoning.map((line) => `- Champion: ${line}`),
    ...report.recommendation.runnerUp.reasoning.map((line) => `- Runner-up: ${line}`),
    ...report.recommendation.thirdPlace.reasoning.map((line) => `- Third place: ${line}`),
    '',
    'Tournament-path assumptions:',
    ...report.tournamentPathAssumptions.map((line) => `- ${line}`),
    '',
    'Alternatives:',
    ...report.alternatives.flatMap((alternative, index) => [
      `${index + 1}. ${alternative.champion} / ${alternative.runnerUp} / ${alternative.thirdPlace}`,
      ...alternative.rationale.map((line) => `   - ${line}`),
    ]),
    '',
    'Confidence drivers:',
    ...report.confidence.drivers.map((line) => `- ${line}`),
    report.bonusPoints
      ? `Bonus points: champion ${report.bonusPoints.championPoints}, runner-up ${report.bonusPoints.runnerUpPoints}, third-place ${report.bonusPoints.thirdPlacePoints}, exact position only=${report.bonusPoints.exactPositionOnly}`
      : 'Bonus points: not configured',
    report.sourceWarnings.length ? ['', 'Source warnings:', ...report.sourceWarnings.map((line) => `- ${line}`)].join('\n') : null,
    '',
    ...report.notes.map((line) => `Note: ${line}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildPick(
  position: PodiumStrategyPick['position'],
  team: string,
  rating: number,
  confidence: number,
  reasoning: string[],
): PodiumStrategyPick {
  return {
    position,
    team,
    rating,
    confidence: round4(confidence),
    reasoning,
  };
}

function buildTimingWindow(
  profile: TournamentProfile,
  generatedAt: string,
): PodiumStrategyReport['timingWindow'] {
  const podiumPick = profile.podiumPick;
  if (!podiumPick) {
    return {
      enabled: false,
      status: 'disabled',
      phaseKey: null,
      targetMatchId: null,
      targetMatchLabel: null,
      expectedMatchupDefinedAt: null,
      kickoffAt: null,
      opportunityWindowHours: null,
      lockSource: null,
      hoursUntilExpectedMatchup: null,
      hoursUntilKickoff: null,
    };
  }

  const nowMs = Date.parse(generatedAt);
  const expectedMs = podiumPick.expectedMatchupDefinedAt ? Date.parse(podiumPick.expectedMatchupDefinedAt) : NaN;
  const kickoffMs = podiumPick.kickoffAt ? Date.parse(podiumPick.kickoffAt) : NaN;
  const status = !podiumPick.enabled
    ? 'disabled'
    : Number.isFinite(expectedMs) && Number.isFinite(kickoffMs)
      ? nowMs < expectedMs
        ? 'pre_window'
        : nowMs <= kickoffMs
          ? 'open'
          : 'closed'
      : 'unknown';

  return {
    enabled: podiumPick.enabled,
    status,
    phaseKey: podiumPick.phaseKey,
    targetMatchId: podiumPick.targetMatchId,
    targetMatchLabel: podiumPick.targetMatchLabel,
    expectedMatchupDefinedAt: podiumPick.expectedMatchupDefinedAt,
    kickoffAt: podiumPick.kickoffAt,
    opportunityWindowHours: podiumPick.opportunityWindowHours,
    lockSource: podiumPick.lockSource ?? null,
    hoursUntilExpectedMatchup: Number.isFinite(expectedMs) ? round2((expectedMs - nowMs) / 3_600_000) : null,
    hoursUntilKickoff: Number.isFinite(kickoffMs) ? round2((kickoffMs - nowMs) / 3_600_000) : null,
  };
}

function buildPodiumConfidence(input: {
  timingStatus: PodiumStrategyReport['timingWindow']['status'];
  championRating: number;
  fourthRating: number;
  sourceWarningCount: number;
}): PodiumStrategyReport['confidence'] {
  const ratingSeparation = Math.min(1, Math.max(0, (input.championRating - input.fourthRating) / 220));
  const timingAdjustment =
    input.timingStatus === 'open'
      ? 0.08
      : input.timingStatus === 'pre_window'
        ? -0.04
        : input.timingStatus === 'closed'
          ? -0.16
          : -0.1;
  const warningAdjustment = Math.min(0.12, input.sourceWarningCount * 0.04);
  const score = round4(clamp(0.56 + ratingSeparation * 0.18 + timingAdjustment - warningAdjustment, 0.25, 0.82));
  const label = score >= 0.7 ? 'high' : score >= 0.5 ? 'medium' : 'low';

  return {
    score,
    label,
    drivers: [
      `Top-seed separation contributes ${round4(ratingSeparation)} to confidence.`,
      `Timing status is ${input.timingStatus}; bracket clarity improves once the R32 matchup is fully defined.`,
      'Seeded ratings are operator priors, not a live market or injury-adjusted model.',
    ],
  };
}

function buildTournamentPathAssumptions(profile: TournamentProfile, teams: string[]): string[] {
  const finalPhase = profile.phases.find((phase) => phase.key === 'final');
  const semiPhase = profile.phases.find((phase) => phase.key === 'semi_final');
  const thirdPlacePhase = profile.phases.find((phase) => phase.key === 'third_place');

  return [
    `${teams[0]} and ${teams[1]} are treated as the most likely finalist pair under current seeded ratings.`,
    `${teams[2]} and ${teams[3]} are treated as high-probability semi-final contenders for the bronze path.`,
    semiPhase ? `Semi-final phase multiplier in SmartCup profile: x${semiPhase.pointsWeight}.` : 'Semi-final phase is not configured yet.',
    thirdPlacePhase
      ? `Third-place match multiplier in SmartCup profile: x${thirdPlacePhase.pointsWeight}.`
      : 'Third-place match phase is not configured yet.',
    finalPhase ? `Final phase multiplier in SmartCup profile: x${finalPhase.pointsWeight}.` : 'Final phase is not configured yet.',
    'Actual bracket side, injuries, suspensions, and odds should be rechecked before submitting a podium pick.',
  ];
}

function buildPodiumSourceWarnings(
  profile: TournamentProfile,
  timingStatus: PodiumStrategyReport['timingWindow']['status'],
): string[] {
  const warnings: string[] = [];
  if (!profile.podiumPick?.enabled) warnings.push('Tournament profile does not enable podium picks.');
  if (timingStatus === 'pre_window') {
    warnings.push('Podium matchup window has not opened yet; current slate is a pre-window strategy assumption.');
  }
  if (timingStatus === 'closed') {
    warnings.push('Podium timing reference is already past; verify contract state before using this report.');
  }
  if (profile.podiumPick?.lockSource !== 'contract_r32_lock_time') {
    warnings.push('Podium timing uses profile or published-rule data; reconcile live BolaoCore r32_lock_time before submission.');
  }
  warnings.push('No live odds/news/injury provider is included in this podium report yet.');
  return warnings;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
