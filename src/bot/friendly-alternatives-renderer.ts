import type {
  AlternativePickKind,
  AlternativePickRecommendation,
  AlternativePickSetReport,
  DecisionReport,
  PoolOutcome,
} from '../types/index.js';
import { decisionReportVaraUsdPrice, formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

const pickOrder: AlternativePickKind[] = ['safest', 'balanced', 'contrarian', 'leaderboard_upside'];

export function renderFriendlyAlternativePicks(report: DecisionReport): string {
  const alternatives = report.sections?.alternativePickSet;
  if (!alternatives) {
    return [
      'Alternative picks',
      'Read-only analysis. No report was saved and no transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Alternative picks are not available for this report.',
      '',
      'Next action',
      'Run a fresh single-match prediction preview before approving anything.',
    ].join('\n');
  }

  const orderedPicks = orderPicks(alternatives);

  return [
    'Alternative picks',
    'Read-only analysis. No report was saved and no transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Current default pick: ${formatScore(report.selected.score)} ${outcomeLabel(report.selected.outcome)} under ${formatMode(report.riskMode)} risk.`,
    '',
    'How to read this',
    '- Safest protects forecast/points floor.',
    '- Balanced is the normal all-around choice.',
    '- Contrarian searches for a less crowded score with enough forecast support.',
    '- Leaderboard-upside prioritizes rank and final-prize equity swing.',
    '',
    'Pick comparison',
    ...orderedPicks.flatMap((pick, index) => renderPick(report, pick, index + 1)),
    '',
    'Strategy read',
    ...strategyRead(alternatives, orderedPicks).map((line) => `- ${line}`),
    '',
    'Data quality',
    ...friendlyWarnings(alternatives).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(orderedPicks),
  ].join('\n');
}

function renderPick(report: DecisionReport, pick: AlternativePickRecommendation, index: number): string[] {
  const price = decisionReportVaraUsdPrice(report);
  const equity =
    pick.finalPrizeEquityDeltaPlanck === null
      ? 'not available'
      : formatFriendlyPlanckAmount(pick.finalPrizeEquityDeltaPlanck, price);

  return [
    `${index}. ${friendlyKindLabel(pick.kind)}: ${formatScore(pick.score)} ${outcomeLabel(pick.outcome)}`,
    `   - Confidence: ${pick.confidence}; source mode: ${formatMode(pick.sourceRiskMode)}.`,
    `   - Exact-score chance: ${formatPercent(pick.exactScoreProbability)}; expected tournament value: ${formatPoints(pick.expectedWeightedPoints)}.`,
    `   - Cash payout ROI: ${formatRoi(pick.expectedRoi)}; top-five chance: ${formatPercentOrUnavailable(pick.topFiveProbability)}.`,
    `   - Final-prize equity swing: ${equity}.`,
    `   - Why: ${friendlyRationale(pick)}`,
  ];
}

function strategyRead(alternatives: AlternativePickSetReport, picks: AlternativePickRecommendation[]): string[] {
  if (picks.length === 0) return ['No alternative picks were available from the current candidate set.'];

  const safest = findPick(picks, 'safest');
  const balanced = findPick(picks, 'balanced');
  const contrarian = findPick(picks, 'contrarian');
  const upside = findPick(picks, 'leaderboard_upside');
  const lines = [alternatives.summary];

  if (balanced && safest && scoreKey(balanced) === scoreKey(safest)) {
    lines.push('The safest and balanced choices overlap, so the default pick is also the lower-volatility option.');
  } else if (balanced && safest) {
    lines.push(`Use ${formatScore(safest.score)} when protecting points matters more than the default ${formatScore(balanced.score)} recommendation.`);
  }
  if (contrarian) {
    lines.push(`Use ${formatScore(contrarian.score)} only when you intentionally want differentiation from public score clusters.`);
  }
  if (upside) {
    lines.push(`Use ${formatScore(upside.score)} when leaderboard/rank upside matters more than pure forecast safety.`);
  }
  return lines;
}

function nextAction(picks: AlternativePickRecommendation[]): string {
  const balanced = findPick(picks, 'balanced');
  const upside = findPick(picks, 'leaderboard_upside');
  if (!balanced) return 'Run a fresh single-match preview first, then compare alternatives again before approval.';
  if (upside && scoreKey(upside) !== scoreKey(balanced)) {
    return `Default to ${formatScore(balanced.score)} unless competitor analysis shows you need the ${formatScore(upside.score)} leaderboard-upside swing. Approval still requires the normal guarded flow.`;
  }
  return `Default to ${formatScore(balanced.score)} unless your rank posture says to protect lead or chase upside. Approval still requires the normal guarded flow.`;
}

function friendlyRationale(pick: AlternativePickRecommendation): string {
  const cleaned = pick.rationale
    .map((line) => line.replace(/-?\d+ planck/g, 'a VARA-denominated equity estimate'))
    .slice(0, 2);
  if (cleaned.length === 0) return 'Selected from the same model candidates used by the main prediction preview.';
  return cleaned.join(' ');
}

function friendlyWarnings(alternatives: AlternativePickSetReport): string[] {
  const friendlySourceWarnings = renderFriendlySourceWarningBullets(alternatives.warnings, 5);
  const warnings = alternatives.warnings.map((warning) => {
    const text = warning.toLowerCase();
    if (text.includes('opponent-aware') || text.includes('indexer')) {
      return 'Opponent/leaderboard reads were partial, so rank-upside and top-five fields should be refreshed before approval.';
    }
    if (text.includes('overlap')) {
      return 'Some categories selected the same score, which usually means the candidate pool has one clear favorite.';
    }
    return warning;
  });
  const combined = [...friendlySourceWarnings, ...warnings];
  if (combined.length === 0) return ['No major alternative-pick warnings were detected.'];
  return [...new Set(combined)].slice(0, 5);
}

function orderPicks(alternatives: AlternativePickSetReport): AlternativePickRecommendation[] {
  return [...alternatives.picks].sort((left, right) => pickOrder.indexOf(left.kind) - pickOrder.indexOf(right.kind));
}

function findPick(
  picks: AlternativePickRecommendation[],
  kind: AlternativePickKind,
): AlternativePickRecommendation | undefined {
  return picks.find((pick) => pick.kind === kind);
}

function friendlyKindLabel(kind: AlternativePickKind): string {
  if (kind === 'safest') return 'Safest';
  if (kind === 'balanced') return 'Balanced';
  if (kind === 'contrarian') return 'Contrarian';
  return 'Leaderboard-upside';
}

function outcomeLabel(outcome: PoolOutcome): string {
  if (outcome === 'home') return 'home win';
  if (outcome === 'away') return 'away win';
  return 'draw';
}

function formatScore(score: { home: number; away: number }): string {
  return `${score.home}-${score.away}`;
}

function scoreKey(pick: AlternativePickRecommendation): string {
  return `${pick.score.home}-${pick.score.away}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPercentOrUnavailable(value: number | null): string {
  return value === null ? 'not available' : formatPercent(value);
}

function formatRoi(value: number | null): string {
  if (value === null) return 'not available';
  return `${(value * 100).toFixed(1)}%`;
}

function formatPoints(value: number | null): string {
  if (value === null) return 'not available';
  return `${value.toFixed(2)} weighted points`;
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
