import type { DecisionReport, PoolOutcome, TimingStrategyReport } from '../types/index.js';
import { decisionReportVaraUsdPrice, formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyPredictionPreview(report: DecisionReport): string {
  const exactPoints = report.sourceSnapshots.tournamentProfile.scoring.exactScorePoints * report.tournament.phaseWeight;
  const outcomePoints = report.sourceSnapshots.tournamentProfile.scoring.correctOutcomePoints * report.tournament.phaseWeight;
  const payout = payoutBullet(report);
  const timing = report.sections?.timingStrategy;
  const alternatives = report.sections?.alternativePickSet;
  const position = report.sections?.tournamentPositionStrategy;
  const warnings = friendlyWarnings(report);
  const varaUsdPrice = decisionReportVaraUsdPrice(report);

  return [
    'Prediction preview',
    'No transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Recommended pick: ${report.summary.recommendation}`,
    `Risk mode: ${formatRiskMode(report.riskMode)}`,
    `Confidence: ${capitalize(report.summary.confidenceLabel)}`,
    '',
    'Why this pick',
    `- Win/draw probabilities: ${report.match.home} ${formatPercent(report.probabilities.home)}; draw ${formatPercent(report.probabilities.draw)}; ${report.match.away} ${formatPercent(report.probabilities.away)}.`,
    `- The recommended outcome is ${outcomeLabel(report.selected.outcome, report.match.home, report.match.away)}.`,
    `- Exact ${report.selected.score.home}-${report.selected.score.away} probability: ${formatPercent(report.probabilities.exactScore)}.`,
    alternatives?.summary ? `- ${alternatives.summary}.` : null,
    '',
    'Points view',
    `- Expected tournament value: ${formatNumber(report.economics.expectedWeightedPoints)} points.`,
    '- This is the model average: exact score chance, outcome-only chance, and wrong-result chance combined into one expected leaderboard-points number.',
    `- ${report.tournament.phase} multiplier: x${report.tournament.phaseWeight}.`,
    `- Exact score pays ${pluralPoints(exactPoints)}; correct outcome pays ${pluralPoints(outcomePoints)}.`,
    '',
    'Money / payout view',
    `- ${payout}`,
    `- Capital at risk: ${formatFriendlyPlanckAmount(report.economics.userCapitalAtRiskPlanck, varaUsdPrice)}.`,
    payout.includes('negative') || payout.includes('-')
      ? '- This pick is stronger as a leaderboard/points play than as a direct payout play.'
      : '- This pick has a positive payout view under the current model and pool assumptions.',
    '',
    'Strategy',
    timing ? `- Timing: ${formatTiming(timing)}.` : null,
    position ? `- Tournament position: ${position.recommendation}` : null,
    report.sections?.crowdContrarianMap?.summary ? `- Crowd: ${report.sections.crowdContrarianMap.summary}` : null,
    '',
    'Data quality',
    ...friendlyDataQuality(report),
    ...warnings.map((warning) => `- ${warning}`),
    '',
    'Next action',
    nextAction(report),
    '',
    `Saved report id: ${report.id}`,
    'Execution requires the Approve Plan button and all wallet safety guards.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function friendlyDataQuality(report: DecisionReport): string[] {
  const confidence = report.sections?.confidenceDegradation;
  const quality = report.sections?.sourceQuality;
  const lines: string[] = [];
  if (confidence) {
    const changed =
      confidence.originalLabel !== confidence.adjustedLabel
        ? ` Confidence was reduced from ${confidence.originalLabel} to ${confidence.adjustedLabel}.`
        : '';
    lines.push(`- Overall confidence is ${confidence.adjustedLabel} because source coverage is ${coverageLabel(confidence.degradationLevel)}.${changed}`);
  }
  if (quality) {
    const score = `${quality.score.toFixed(1)}/100`;
    lines.push(`- Source quality: ${quality.label} (${score}).`);
    if (quality.suggestedRetryAt) {
      lines.push(`- Suggested next review: ${quality.suggestedRetryAt}. Rerun the analysis around then; this is not a transaction retry.`);
    }
  }
  return lines;
}

function payoutBullet(report: DecisionReport): string {
  const summary = report.summary.bullets.find((bullet) => bullet.startsWith('Cash payout EV:'));
  if (summary) return summary.replace(/^Cash payout EV:\s*/, 'Cash payout EV is ').replace(/(-?\d+\.\d{2})\d*%/g, '$1%');
  if (report.economics.expectedRoi === null) return 'Cash payout EV is unavailable.';
  return `Cash payout EV is ${formatPercent(report.economics.expectedRoi)} ROI.`;
}

function coverageLabel(value: string): string {
  if (value === 'none') return 'complete enough for this stage';
  if (value === 'minor') return 'mostly complete';
  if (value === 'moderate') return 'partly incomplete';
  if (value === 'severe') return 'limited';
  return value;
}

function nextAction(report: DecisionReport): string {
  const timing = report.sections?.timingStrategy;
  if (timing?.recommendation === 'wait') {
    return `Wait and refresh before approving. Suggested next review: ${timing.nextReviewAt ?? 'later, before cutoff'}.`;
  }
  if (timing?.recommendation === 'blocked_by_cutoff') {
    return 'Do not submit: this match is inside the cutoff/safety window.';
  }
  return 'Review the recommendation. Use Approve Plan only if you want guarded wallet execution.';
}

function friendlyWarnings(report: DecisionReport): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(report.sourceWarnings, 5));
  for (const warning of report.sourceWarnings) {
    const text = warning.toLowerCase();
    if (text.includes('crowd') || text.includes('pool')) {
      categories.add('Crowd/pool signal is thin and can change as users submit predictions.');
    } else if (text.includes('user_points') || text.includes('leaderboard')) {
      categories.add('Leaderboard posture is provisional until live points data is fuller.');
    }
  }
  return [...categories].slice(0, 5);
}

function formatTiming(timing: TimingStrategyReport): string {
  if (timing.recommendation === 'wait') return `wait and refresh (${timing.confidence} confidence)`;
  if (timing.recommendation === 'blocked_by_cutoff') return 'blocked by cutoff';
  return `predict now (${timing.confidence} confidence)`;
}

function outcomeLabel(outcome: PoolOutcome, home: string, away: string): string {
  if (outcome === 'home') return `${home} win`;
  if (outcome === 'away') return `${away} win`;
  return 'Draw';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return 'n/a';
  return value.toFixed(2);
}

function pluralPoints(value: number): string {
  return `${value} ${value === 1 ? 'point' : 'points'}`;
}

function formatRiskMode(value: string): string {
  return value
    .split('_')
    .map(capitalize)
    .join(' ');
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}
