import type {
  ContrarianScoreOpportunity,
  CrowdContrarianMapReport,
  CrowdOutcomeCluster,
  DecisionReport,
  PoolOutcome,
  PublicScoreCluster,
} from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyCrowdContrarianMap(report: DecisionReport): string {
  const crowd = report.sections?.crowdContrarianMap;
  if (!crowd) {
    return [
      'Crowd / contrarian map',
      'Preview only. No transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Crowd map is not available for this report.',
      '',
      'Next action',
      'Run a fresh prediction preview after visible pool data is available.',
      '',
      `Saved report id: ${report.id}`,
      'Execution requires the Approve Plan button and all wallet safety guards.',
    ].join('\n');
  }

  return [
    'Crowd / contrarian map',
    'Preview only. No transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Selected pick: ${report.selected.score.home}-${report.selected.score.away} ${outcomeLabel(report.selected.outcome, report.match.home, report.match.away)}.`,
    `Crowd confidence: ${confidenceLabel(crowd.confidence)} (${formatPercent(crowd.confidence)}).`,
    '',
    'Main takeaway',
    `- ${crowd.summary}`,
    '- Exact-score crowding is estimated from visible home/draw/away pool data plus public-score priors.',
    '',
    'Visible outcome crowding',
    ...outcomeLines(report, crowd.outcomeClusters),
    '',
    'Likely public score clusters',
    ...publicClusterLines(crowd.likelyPublicScoreClusters),
    '',
    'Differentiated opportunities',
    ...opportunityLines(crowd.differentiatedOpportunities),
    '',
    'Selected score read',
    ...selectedScoreLines(crowd.selectedScoreOpportunity),
    '',
    'Data quality',
    ...friendlyWarnings(crowd).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(crowd),
    '',
    `Saved report id: ${report.id}`,
    'Execution requires the Approve Plan button and all wallet safety guards.',
  ].join('\n');
}

function outcomeLines(report: DecisionReport, outcomes: CrowdOutcomeCluster[]): string[] {
  if (outcomes.length === 0) return ['- No visible outcome crowding is available yet.'];
  const labels: Record<PoolOutcome, string> = {
    home: `${report.match.home} win`,
    draw: 'Draw',
    away: `${report.match.away} win`,
  };
  return outcomes.map(
    (outcome) =>
      `- ${labels[outcome.outcome]}: ${formatPercent(outcome.shareOfMatchPool)} of visible pool, ${outcome.bets} bet${outcome.bets === 1 ? '' : 's'}, ${levelLabel(outcome.crowdLevel)}.`,
  );
}

function publicClusterLines(clusters: PublicScoreCluster[]): string[] {
  if (clusters.length === 0) return ['- No public score clusters are available yet.'];
  return clusters.slice(0, 5).map((cluster, index) => {
    return `${index + 1}. ${formatScore(cluster.score)} ${outcomeLabelShort(cluster.outcome)}: estimated crowd share ${formatPercent(cluster.estimatedShareOfMatchPool)}, estimated bets ${formatNumber(cluster.estimatedBets)}, ${levelLabel(cluster.clusterLevel)}.`;
  });
}

function opportunityLines(opportunities: ContrarianScoreOpportunity[]): string[] {
  if (opportunities.length === 0) return ['- No differentiated opportunities are available yet.'];
  return opportunities.slice(0, 5).map((opportunity, index) => {
    return `${index + 1}. ${formatScore(opportunity.score)} ${outcomeLabelShort(opportunity.outcome)}: ${opportunity.opportunityLevel} opportunity, forecast ${formatPercent(opportunity.forecastProbability)}, estimated crowd ${formatPercent(opportunity.estimatedCrowdShare)}, differentiation ${formatPercent(opportunity.differentiationScore)}.`;
  });
}

function selectedScoreLines(opportunity: ContrarianScoreOpportunity | null): string[] {
  if (!opportunity) return ['- Selected score is not present in the current crowd opportunity map.'];
  return [
    `- ${formatScore(opportunity.score)} is a ${opportunity.opportunityLevel} contrarian opportunity.`,
    `- Forecast chance: ${formatPercent(opportunity.forecastProbability)}; estimated crowd share: ${formatPercent(opportunity.estimatedCrowdShare)}; differentiation score: ${formatPercent(opportunity.differentiationScore)}.`,
    ...opportunity.rationale.slice(0, 2).map((line) => `- ${friendlyRationale(line)}`),
  ];
}

function nextAction(crowd: CrowdContrarianMapReport): string {
  const selected = crowd.selectedScoreOpportunity;
  if (crowd.confidence < 0.4) {
    return 'Treat this as directional only. Refresh after more visible predictions arrive before using crowd strategy for approval.';
  }
  if (selected?.opportunityLevel === 'high') {
    return 'The selected score has meaningful differentiation. Compare with Alternative Picks and leaderboard posture before approval.';
  }
  if (selected?.opportunityLevel === 'medium') {
    return 'The selected score has some differentiation, but points, payout EV, and timing should still drive the final choice.';
  }
  return 'Crowd edge is limited for the selected score. Use this mainly to avoid obvious public clusters.';
}

function friendlyWarnings(crowd: CrowdContrarianMapReport): string[] {
  const friendlySourceWarnings = renderFriendlySourceWarningBullets(crowd.warnings, 5);
  const warnings = crowd.warnings.map((warning) => {
    const text = warning.toLowerCase();
    if (text.includes('small')) return 'Visible pool sample is small, so public clusters can move quickly.';
    if (text.includes('confidence') || text.includes('outcome pools')) {
      return 'Exact-score crowding is estimated, not directly observed, because SmartCup exposes outcome pools rather than exact-score pools.';
    }
    return warning;
  });
  const combined = [...friendlySourceWarnings, ...warnings];
  if (combined.length === 0) return ['No major crowd-map warnings were detected.'];
  return [...new Set(combined)].slice(0, 5);
}

function friendlyRationale(line: string): string {
  return line
    .replace(/0\.(\d+)/g, (value) => formatPercent(Number(value)))
    .replace(/\bhome\b/g, 'home win')
    .replace(/\baway\b/g, 'away win');
}

function confidenceLabel(value: number): string {
  if (value >= 0.7) return 'high';
  if (value >= 0.45) return 'medium';
  return 'low';
}

function levelLabel(value: 'low' | 'medium' | 'high'): string {
  if (value === 'high') return 'high crowding';
  if (value === 'medium') return 'medium crowding';
  return 'low crowding';
}

function outcomeLabel(outcome: PoolOutcome, home: string, away: string): string {
  if (outcome === 'home') return `${home} win`;
  if (outcome === 'away') return `${away} win`;
  return 'draw';
}

function outcomeLabelShort(outcome: PoolOutcome): string {
  if (outcome === 'home') return 'home win';
  if (outcome === 'away') return 'away win';
  return 'draw';
}

function formatScore(score: { home: number; away: number }): string {
  return `${score.home}-${score.away}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
