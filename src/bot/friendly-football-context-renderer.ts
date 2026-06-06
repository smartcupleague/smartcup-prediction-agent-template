import type {
  DecisionReport,
  FootballContextRiskReport,
  FootballContextRiskSignal,
  NormalizedLineupSnapshot,
  NormalizedNewsItem,
  NormalizedPlayerAvailability,
  PoolOutcome,
} from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyFootballContextRisk(report: DecisionReport): string {
  const context = report.sections?.footballContextRisk;
  if (!context) {
    return [
      'Lineup / injury / news risk',
      'Preview only. No transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Football context is not available for this report.',
      '',
      'Next action',
      'Add a manual football-context JSON snapshot or run the normal prediction preview without this context layer.',
      '',
      `Saved report id: ${report.id}`,
      'Execution requires the Approve Plan button and all wallet safety guards.',
    ].join('\n');
  }

  return [
    'Lineup / injury / news risk',
    'Preview only. No transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Selected pick: ${report.selected.score.home}-${report.selected.score.away} ${outcomeLabel(report.selected.outcome, report.match.home, report.match.away)}.`,
    `Provider: ${context.provider}${context.providerConfigured ? '' : ' (not configured)'}.`,
    '',
    'Main takeaway',
    `- ${friendlySummary(context)}.`,
    `- Overall risk: ${riskLabel(context.overallRisk)}; freshness: ${freshnessLabel(context.freshness)}; uncertainty: ${uncertaintyLabel(context.uncertainty)}.`,
    '',
    'Lineups',
    `- ${report.match.home}: ${lineupLine(context.lineups.home)}.`,
    `- ${report.match.away}: ${lineupLine(context.lineups.away)}.`,
    '',
    'Availability and suspensions',
    ...availabilityLines(context),
    '',
    'News risk',
    ...newsLines(context.news),
    '',
    'Important signals',
    ...signalLines(context.signals),
    '',
    'Data quality',
    ...friendlyWarnings(context).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(context),
    '',
    `Saved report id: ${report.id}`,
    'Execution requires the Approve Plan button and all wallet safety guards.',
  ].join('\n');
}

function friendlySummary(context: FootballContextRiskReport): string {
  if (!context.providerConfigured) {
    return 'No lineup, injury, suspension, or news provider is configured yet';
  }
  if (context.overallRisk === 'high') {
    return 'Football context contains high-risk signals, so refresh before approving a prediction';
  }
  if (context.overallRisk === 'medium') {
    return 'Football context has meaningful uncertainty; treat the pick as provisional';
  }
  if (context.overallRisk === 'unknown') {
    return 'Football context is too incomplete to confirm whether lineups/news support the pick';
  }
  return 'No major lineup, injury, suspension, or news risk was detected from the available context';
}

function lineupLine(lineup: NormalizedLineupSnapshot | null): string {
  if (!lineup) return 'missing lineup snapshot';
  const starters = lineup.players.filter((player) => player.role === 'starter').length;
  const absent = lineup.players.filter((player) => player.role === 'absent').length;
  return [
    `${lineup.status} lineup`,
    lineup.formation ? `formation ${lineup.formation}` : null,
    `${starters} starter${starters === 1 ? '' : 's'} listed`,
    absent > 0 ? `${absent} absent` : null,
    `confidence ${formatPercent(lineup.confidence)}`,
    `updated ${lineup.updatedAt}`,
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
}

function availabilityLines(context: FootballContextRiskReport): string[] {
  const risky = context.availability
    .filter((entry) => entry.status === 'out' || entry.status === 'doubtful' || entry.status === 'suspended')
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
  const lines = [
    `- Availability records: ${context.availability.length}; suspensions: ${context.suspensions.length}.`,
  ];
  if (risky.length === 0) {
    lines.push('- No out/doubtful/suspended player records were returned.');
    return lines;
  }
  for (const entry of risky.slice(0, 5)) {
    lines.push(
      `- ${entry.team}: ${entry.player} is ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}; severity ${entry.severity}; confidence ${formatPercent(entry.confidence)}.`,
    );
  }
  if (risky.length > 5) lines.push(`- Plus ${risky.length - 5} more availability risk record(s).`);
  return lines;
}

function newsLines(news: NormalizedNewsItem[]): string[] {
  if (news.length === 0) return ['- No news items were returned for this match.'];
  const sorted = [...news].sort((left, right) => {
    const impactDiff = impactRank(right.impactDirection) - impactRank(left.impactDirection);
    if (impactDiff !== 0) return impactDiff;
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  });
  return [
    `- News items: ${news.length}; negative-impact items: ${news.filter((item) => item.impactDirection === 'negative').length}.`,
    ...sorted.slice(0, 4).map((item) => {
      const reliability = item.sourceReliability ?? item.confidence;
      return `- ${item.title}: ${impactLabel(item.impactDirection)}, reliability ${formatPercent(reliability)}, published ${item.publishedAt}.`;
    }),
  ];
}

function signalLines(signals: FootballContextRiskSignal[]): string[] {
  const important = signals
    .filter((signal) => signal.riskLevel !== 'low' || signal.uncertainty === 'high' || signal.freshness === 'missing')
    .slice(0, 6);
  if (important.length === 0) return ['- No high-priority context signals were detected.'];
  return important.map(
    (signal) =>
      `- ${signal.label}: ${riskLabel(signal.riskLevel)}, ${freshnessLabel(signal.freshness)}, ${uncertaintyLabel(signal.uncertainty)}. ${signal.detail}`,
  );
}

function friendlyWarnings(context: FootballContextRiskReport): string[] {
  const friendlySourceWarnings = renderFriendlySourceWarningBullets(context.warnings, 5);
  const warnings = context.warnings.map((warning) => {
    const text = warning.toLowerCase();
    if (text.includes('not configured')) return 'No football-context provider/manual JSON is configured yet.';
    if (text.includes('missing') || text.includes('stale')) return 'Football-context data is missing or stale; refresh before approval.';
    if (text.includes('uncertainty')) return 'Football-context uncertainty is high, usually because lineups or availability data are incomplete.';
    return warning;
  });
  const combined = [...friendlySourceWarnings, ...warnings];
  if (combined.length === 0) return ['No major football-context warnings were detected.'];
  return [...new Set(combined)].slice(0, 5);
}

function nextAction(context: FootballContextRiskReport): string {
  if (!context.providerConfigured) {
    return 'Configure `SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON` or a future live lineup/news provider, then rerun this check before approval.';
  }
  if (context.overallRisk === 'high' || context.uncertainty === 'high' || context.freshness === 'stale') {
    return 'Wait for fresher lineup/news context or rerun closer to kickoff before approving a prediction.';
  }
  if (context.overallRisk === 'medium') {
    return 'Use this as a caution layer: compare against timing strategy and alternative picks before approving.';
  }
  return 'Context risk is low from available inputs; still use the normal guarded approval flow if you choose to submit.';
}

function riskLabel(value: FootballContextRiskReport['overallRisk'] | FootballContextRiskSignal['riskLevel']): string {
  if (value === 'high') return 'high risk';
  if (value === 'medium') return 'medium risk';
  if (value === 'unknown') return 'unknown risk';
  return 'low risk';
}

function freshnessLabel(value: FootballContextRiskReport['freshness'] | FootballContextRiskSignal['freshness']): string {
  if (value === 'fresh') return 'fresh';
  if (value === 'usable') return 'usable';
  if (value === 'stale') return 'stale';
  if (value === 'missing') return 'missing';
  return 'unknown freshness';
}

function uncertaintyLabel(
  value: FootballContextRiskReport['uncertainty'] | FootballContextRiskSignal['uncertainty'],
): string {
  if (value === 'high') return 'high uncertainty';
  if (value === 'medium') return 'medium uncertainty';
  if (value === 'low') return 'low uncertainty';
  return 'unknown uncertainty';
}

function outcomeLabel(outcome: PoolOutcome, home: string, away: string): string {
  if (outcome === 'home') return `${home} win`;
  if (outcome === 'away') return `${away} win`;
  return 'draw';
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function severityRank(value: NormalizedPlayerAvailability['severity']): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function impactRank(value: NormalizedNewsItem['impactDirection']): number {
  if (value === 'negative') return 3;
  if (value === 'unknown') return 2;
  if (value === 'neutral') return 1;
  return 0;
}

function impactLabel(value: NormalizedNewsItem['impactDirection']): string {
  if (value === 'negative') return 'negative impact';
  if (value === 'positive') return 'positive impact';
  if (value === 'neutral') return 'neutral impact';
  return 'unknown impact';
}
