import type { DecisionReport, PoolOutcome } from '../types/index.js';
import { decisionReportVaraUsdPrice, formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export type FriendlyBundleRenderOptions = {
  tournamentName: string;
  riskMode: string;
};

export function renderFriendlyPersonalBundle(
  decisions: DecisionReport[],
  options: FriendlyBundleRenderOptions,
): string {
  const sorted = [...decisions].sort(compareBundlePriority);
  const best = sorted[0] ?? null;
  const waitCount = decisions.filter((decision) => decision.sections?.timingStrategy?.recommendation === 'wait').length;
  const criticalCount = decisions.filter((decision) => decision.sections?.sourceQuality?.label === 'critical').length;
  const degradedCount = decisions.filter((decision) =>
    ['degraded', 'critical'].includes(decision.sections?.sourceQuality?.label ?? ''),
  ).length;
  const totalCapitalAtRisk = decisions.reduce((sum, decision) => sum + BigInt(decision.economics.userCapitalAtRiskPlanck), 0n);
  const totalExpectedPoints = decisions.reduce((sum, decision) => sum + (decision.economics.expectedWeightedPoints ?? 0), 0);
  const varaUsdPrice = decisions.map(decisionReportVaraUsdPrice).find((price) => price !== null) ?? null;

  return [
    'Personal 5-match bundle',
    'This stays in your personal agent workspace. No transaction was created.',
    '',
    `Tournament: ${options.tournamentName}`,
    `Risk mode: ${formatMode(options.riskMode)}`,
    `Matches analyzed: ${decisions.length}`,
    `Saved reports: ${decisions.map((decision) => decision.id).join(', ')}`,
    '',
    'Bundle read',
    best
      ? `- Best first review: match #${best.matchId}, ${best.match.home} vs ${best.match.away}, ${formatScore(best)}.`
      : '- Best first review: unavailable.',
    `- Expected tournament value across the bundle: ${totalExpectedPoints.toFixed(2)} points.`,
    '- This is the model average across all five matches, combining exact-score, outcome-only, and wrong-result scenarios.',
    `- Capital at risk if all five are later approved: ${formatFriendlyPlanckAmount(totalCapitalAtRisk, varaUsdPrice)}.`,
    waitCount > 0
      ? `- Timing note: ${pluralMatches(waitCount)} should be refreshed closer to kickoff before approval.`
      : '- Timing note: no bundle match is currently flagged as wait-only.',
    degradedCount > 0
      ? `- Data note: ${pluralMatches(degradedCount)} ${degradedCount === 1 ? 'has' : 'have'} degraded or critical source quality.`
      : '- Data note: no major source-quality degradation detected in the bundle.',
    '',
    'Match-by-match recommendations',
    ...sorted.map(renderBundleDecisionLine),
    '',
    'Priority order',
    ...sorted.map((decision, index) => {
      const reason = priorityReason(decision);
      return `- ${index + 1}. Match #${decision.matchId}: ${reason}`;
    }),
    '',
    'Data quality',
    criticalCount > 0
      ? `- ${pluralMatches(criticalCount)} ${criticalCount === 1 ? 'is' : 'are'} critical quality. Do not approve ${criticalCount === 1 ? 'it' : 'those'} without a refresh.`
      : null,
    ...friendlyWarnings(decisions).map((warning) => `- ${warning}`),
    '',
    'Next action',
    'Review each match separately. Use a single-match preview before approving any saved DecisionReport.',
    'Approval is always per match and still requires the Approve Plan button plus all wallet safety guards.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function renderBundleDecisionLine(decision: DecisionReport): string {
  const sourceQuality = decision.sections?.sourceQuality;
  const timing = decision.sections?.timingStrategy;
  const confidence = decision.sections?.confidenceDegradation?.adjustedLabel ?? decision.summary.confidenceLabel;
  const sourceText = sourceQuality ? `${sourceQuality.label} ${sourceQuality.score.toFixed(0)}/100` : 'not scored';
  const timingText = timing ? timingLabel(timing.recommendation) : 'timing n/a';

  return [
    `- #${decision.matchId} ${decision.match.home} vs ${decision.match.away}:`,
    `${formatScore(decision)}`,
    `${formatOutcome(decision.selected.outcome)}`,
    `exact ${formatPercent(decision.probabilities.exactScore)}`,
    `home/draw/away ${formatPercent(decision.probabilities.home)}/${formatPercent(decision.probabilities.draw)}/${formatPercent(decision.probabilities.away)}`,
    `EV points ${formatNumber(decision.economics.expectedWeightedPoints)}`,
    `confidence ${confidence}`,
    `source ${sourceText}`,
    timingText,
  ].join(' ');
}

function compareBundlePriority(a: DecisionReport, b: DecisionReport): number {
  return priorityScore(b) - priorityScore(a);
}

function priorityScore(decision: DecisionReport): number {
  const points = decision.economics.expectedWeightedPoints ?? 0;
  const exact = decision.probabilities.exactScore;
  const phase = decision.tournament.phaseWeight;
  const quality = (decision.sections?.sourceQuality?.score ?? 50) / 100;
  const waitPenalty = decision.sections?.timingStrategy?.recommendation === 'wait' ? 0.12 : 0;
  const cutoffPenalty = decision.sections?.timingStrategy?.recommendation === 'blocked_by_cutoff' ? 1 : 0;
  return points * 0.5 + exact * 2 + phase * 0.08 + quality * 0.2 - waitPenalty - cutoffPenalty;
}

function priorityReason(decision: DecisionReport): string {
  const timing = decision.sections?.timingStrategy?.recommendation;
  const quality = decision.sections?.sourceQuality?.label;
  if (quality === 'critical') return `${decision.match.home} vs ${decision.match.away}, interesting pick but source quality is critical.`;
  if (timing === 'blocked_by_cutoff') return `${decision.match.home} vs ${decision.match.away}, blocked by cutoff; do not approve.`;
  if (timing === 'wait') return `${decision.match.home} vs ${decision.match.away}, good candidate but refresh closer to kickoff.`;
  return `${decision.match.home} vs ${decision.match.away}, strongest current review candidate.`;
}

function friendlyWarnings(decisions: DecisionReport[]): string[] {
  const categories = new Set<string>();
  for (const decision of decisions) {
    for (const warning of renderFriendlySourceWarningBullets(decision.sourceWarnings, 5)) {
      categories.add(warning);
    }
    for (const warning of decision.sourceWarnings) {
      const text = warning.toLowerCase();
      if (text.includes('leaderboard') || text.includes('user_points')) {
        categories.add('Leaderboard/rank context is provisional for at least one match.');
      }
    }
  }
  if (categories.size === 0) categories.add('No major source warnings were detected across the five matches.');
  return [...categories].slice(0, 5);
}

function formatScore(decision: DecisionReport): string {
  return `${decision.selected.score.home}-${decision.selected.score.away}`;
}

function formatOutcome(outcome: PoolOutcome): string {
  if (outcome === 'home') return 'home win';
  if (outcome === 'away') return 'away win';
  return 'draw';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function timingLabel(value: string): string {
  if (value === 'wait') return 'wait/refresh';
  if (value === 'blocked_by_cutoff') return 'blocked by cutoff';
  if (value === 'predict_now') return 'can preview now';
  return value;
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function pluralMatches(count: number): string {
  return `${count} match${count === 1 ? '' : 'es'}`;
}
