import type { TournamentAdvisoryPriorityMatch, TournamentAdvisoryReport } from '../types/index.js';
import { formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyTournamentAdvisory(report: TournamentAdvisoryReport): string {
  const first = report.priorityMatches[0] ?? null;

  return [
    'Tournament advisory',
    'Personal read-only advisory. This stays in your personal agent workspace and does not create a transaction.',
    '',
    `Tournament: ${report.tournament.name}`,
    `Report id: ${report.id}`,
    `Connected wallet: ${report.wallet.accountName} (${shortAddress(report.wallet.address)})`,
    '',
    'Tournament posture',
    `- Current phase focus: ${report.rollingPlan.currentPhase ?? 'not available yet'}.`,
    `- Review cadence: ${report.rollingPlan.reviewCadence}`,
    `- Eligible open matches: ${report.rollingPlan.openEligibleMatches}.`,
    `- Default risk mode: ${formatMode(report.riskPosture.defaultRiskMode)}.`,
    `- Strategy posture: ${formatMode(report.riskPosture.strategyPosture)}.`,
    `- Leaderboard objective: ${formatMode(report.leaderboardObjective.objective)} - ${report.leaderboardObjective.label}`,
    '',
    'Priority matches',
    ...(report.priorityMatches.length ? report.priorityMatches.slice(0, 5).map(renderPriorityMatch) : ['- No eligible open matches found.']),
    '',
    'Exposure context',
    ...renderExposureContext(report),
    '',
    'Strategy read',
    ...renderStrategyRead(report),
    '',
    'Next actions',
    ...report.nextActions.slice(0, 5).map((action, index) => `- ${index + 1}. ${action}`),
    first ? `- Start with match #${first.matchId} if you only have time for one review.` : null,
    '',
    'Data quality',
    ...friendlyWarnings(report).map((warning) => `- ${warning}`),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function renderPriorityMatch(match: TournamentAdvisoryPriorityMatch, index: number): string {
  return [
    `- ${index + 1}. #${match.matchId} ${match.label}`,
    `${match.phase} x${match.phaseWeight ?? '?'}`,
    `kickoff ${match.kickOffAt}`,
    `safety close ${match.safetyCloseAt}`,
    `${match.hoursUntilSafetyClose}h to safety close`,
    `priority ${match.priorityScore}`,
  ].join(' | ');
}

function renderExposureContext(report: TournamentAdvisoryReport): string[] {
  const exposure = report.stakeExposure;
  return [
    `- Minimum stake: ${exposure.minStakeUsd ? `$${exposure.minStakeUsd} USD` : 'not configured'}.`,
    `- Max stake: ${exposure.maxStakeUsd ? `$${exposure.maxStakeUsd} USD` : formatFriendlyPlanckAmount(exposure.maxStakePlanck, null)}.`,
    `- Max tournament exposure: ${
      exposure.maxTournamentExposureUsd
        ? `$${exposure.maxTournamentExposureUsd} USD`
        : formatFriendlyPlanckAmount(exposure.maxTournamentExposurePlanck, null)
    }.`,
    `- Existing predictions from this wallet: ${exposure.existingPredictionCount} (${exposure.existingPredictionCountSource}).`,
    `- Already submitted match-pool stake: ${formatFriendlyPlanckAmount(exposure.existingStakeInMatchPoolsPlanck, null)}.`,
    BigInt(exposure.existingFreebetPrincipalPlanck || '0') > 0n
      ? `- Existing freebet principal: ${formatFriendlyPlanckAmount(exposure.existingFreebetPrincipalPlanck, null)}.`
      : null,
    `- Pending unsubmitted plan exposure: ${formatFriendlyPlanckAmount(exposure.storedOpenPlanExposurePlanck, null)}.`,
    ...exposure.notes.slice(0, 3).map((line) => `- ${line}`),
  ].filter((line): line is string => line !== null);
}

function renderStrategyRead(report: TournamentAdvisoryReport): string[] {
  const lines = [
    ...report.rollingPlan.phaseFocus.slice(0, 2),
    ...report.riskPosture.rationale.slice(0, 2),
    ...report.leaderboardObjective.rationale.slice(0, 2),
  ];
  return lines.length ? lines.map((line) => `- ${line}`) : ['- Strategy context is unavailable.'];
}

function friendlyWarnings(report: TournamentAdvisoryReport): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(report.sourceWarnings, 5));
  for (const warning of report.sourceWarnings) {
    const text = warning.toLowerCase();
    if (text.includes('duplicate')) categories.add('Duplicate-prediction context may be partial; refresh before approval.');
  }
  if (categories.size === 0) categories.add('No major advisory source warnings were detected.');
  return [...categories].slice(0, 5);
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}
