import type { PodiumStrategyReport } from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyPodiumStrategy(report: PodiumStrategyReport): string {
  return [
    'Champion / podium strategy',
    'Preview first. It does not submit anything unless you use the guarded Approve Podium Pick button.',
    '',
    `Tournament: ${report.tournament.name}`,
    `Report id: ${report.id}`,
    '',
    'Recommended slate',
    `- Champion: ${report.recommendation.champion.team} (${formatPercent(report.recommendation.champion.confidence)} confidence).`,
    `- Runner-up: ${report.recommendation.runnerUp.team} (${formatPercent(report.recommendation.runnerUp.confidence)} confidence).`,
    `- Third place: ${report.recommendation.thirdPlace.team} (${formatPercent(report.recommendation.thirdPlace.confidence)} confidence).`,
    `- Overall confidence: ${report.confidence.label} (${formatPercent(report.confidence.score)}).`,
    '',
    'Timing window',
    ...renderTimingWindow(report),
    '',
    'Why this slate',
    `- ${report.recommendation.champion.team}: ${firstReason(report.recommendation.champion.reasoning)}`,
    `- ${report.recommendation.runnerUp.team}: ${firstReason(report.recommendation.runnerUp.reasoning)}`,
    `- ${report.recommendation.thirdPlace.team}: ${firstReason(report.recommendation.thirdPlace.reasoning)}`,
    '',
    'Tournament-path assumptions',
    ...report.tournamentPathAssumptions.slice(0, 5).map((line) => `- ${line}`),
    '',
    'Alternative slates',
    ...renderAlternatives(report),
    '',
    'Scoring context',
    renderBonusPoints(report),
    '',
    'Data quality',
    ...renderDataQuality(report),
    '',
    'Next action',
    nextAction(report),
  ].join('\n');
}

function renderTimingWindow(report: PodiumStrategyReport): string[] {
  const window = report.timingWindow;
  const lines = [
    `- Status: ${timingStatusLabel(window.status)}.`,
    window.targetMatchLabel ? `- Target reference: ${window.targetMatchLabel}.` : null,
    window.expectedMatchupDefinedAt
      ? `- Matchup clarity expected around: ${window.expectedMatchupDefinedAt}.`
      : '- Matchup clarity date is not configured.',
    window.kickoffAt ? `- Kickoff/lock reference: ${window.kickoffAt}.` : null,
    window.opportunityWindowHours
      ? `- Decision window: about ${window.opportunityWindowHours.min}-${window.opportunityWindowHours.max} hours.`
      : '- Decision window is not configured.',
    window.hoursUntilExpectedMatchup !== null && window.hoursUntilExpectedMatchup > 0
      ? `- Time until expected clarity: ${window.hoursUntilExpectedMatchup} hours.`
      : null,
    window.hoursUntilKickoff !== null && window.hoursUntilKickoff > 0
      ? `- Time until kickoff/lock reference: ${window.hoursUntilKickoff} hours.`
      : null,
  ];
  return lines.filter((line): line is string => line !== null);
}

function renderAlternatives(report: PodiumStrategyReport): string[] {
  if (report.alternatives.length === 0) return ['- No alternative slates are available yet.'];
  return report.alternatives.slice(0, 2).map((alternative, index) => {
    const reason = alternative.rationale[0] ?? 'Alternative path if bracket or crowd assumptions change.';
    return `- ${index + 1}. ${alternative.champion} / ${alternative.runnerUp} / ${alternative.thirdPlace}: ${reason}`;
  });
}

function renderBonusPoints(report: PodiumStrategyReport): string {
  const bonus = report.bonusPoints;
  if (!bonus) return '- Podium bonus points are not configured in this tournament profile.';
  return `- Exact-position bonuses: champion ${bonus.championPoints}, runner-up ${bonus.runnerUpPoints}, third place ${bonus.thirdPlacePoints}. Exact position only: ${bonus.exactPositionOnly ? 'yes' : 'no'}.`;
}

function renderDataQuality(report: PodiumStrategyReport): string[] {
  const lines = [
    `- Confidence drivers: ${report.confidence.drivers.slice(0, 2).join(' ')}`,
    ...friendlyWarnings(report).map((warning) => `- ${warning}`),
  ];
  return lines;
}

function friendlyWarnings(report: PodiumStrategyReport): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(report.sourceWarnings, 5));
  for (const warning of report.sourceWarnings) {
    const text = warning.toLowerCase();
    if (text.includes('pre-window') || text.includes('not opened')) {
      categories.add('This is a pre-window strategy assumption; refresh when the matchup window is actually open.');
    } else if (text.includes('contract') || text.includes('r32_lock_time')) {
      categories.add('Reconcile live BolaoCore timing before submitting a real podium pick.');
    } else if (text.includes('closed')) {
      categories.add('The timing reference may already be closed; verify live contract state before acting.');
    }
  }
  if (categories.size === 0) categories.add('No major podium-source warnings were detected.');
  return [...categories].slice(0, 4);
}

function nextAction(report: PodiumStrategyReport): string {
  if (report.timingWindow.status === 'pre_window') {
    return 'Keep this as the current reference slate, then refresh when the matchup is fully defined before submitting anything.';
  }
  if (report.timingWindow.status === 'open') {
    return 'Refresh odds/news/context, verify the contract timing, then use the guarded podium executor only if you intentionally want to submit.';
  }
  if (report.timingWindow.status === 'closed') {
    return 'Do not submit from this report until live contract state confirms podium picks are still accepted.';
  }
  if (report.timingWindow.status === 'disabled') {
    return 'Do not submit: podium picks are disabled in this tournament profile.';
  }
  return 'Use this as a planning report only, and refresh once live timing/provider data is clearer.';
}

function timingStatusLabel(value: PodiumStrategyReport['timingWindow']['status']): string {
  if (value === 'pre_window') return 'pre-window, useful for planning but not final';
  if (value === 'open') return 'open, but still requires a fresh live check';
  if (value === 'closed') return 'closed or past the configured timing reference';
  if (value === 'disabled') return 'disabled in this tournament profile';
  return 'unknown';
}

function firstReason(lines: string[]): string {
  return lines[0] ?? 'No rationale available.';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
