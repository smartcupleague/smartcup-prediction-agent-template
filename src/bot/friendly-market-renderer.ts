import type {
  DecisionReport,
  MarketComparisonProbability,
  MarketOddsComparisonReport,
  PoolOutcome,
} from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyMarketComparison(report: DecisionReport): string {
  const market = report.sections?.marketComparison;
  if (!market) {
    return [
      'Market / odds comparison',
      'Preview only. No transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Market comparison is not available for this report.',
      '',
      'Next action',
      'Add an odds snapshot or run the normal prediction preview without market comparison.',
      '',
      `Saved report id: ${report.id}`,
      'Execution requires the Approve Plan button and all wallet safety guards.',
    ].join('\n');
  }

  return [
    'Market / odds comparison',
    'Preview only. No transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Selected pick: ${report.selected.score.home}-${report.selected.score.away} ${outcomeLabel(report.selected.outcome, report.match.home, report.match.away)}.`,
    `Provider: ${market.provider}${market.providerConfigured ? '' : ' (not configured)'}.`,
    `Latest odds snapshot: ${market.observedAt ?? 'not available'}.`,
    '',
    'Main takeaway',
    `- ${friendlySummary(market)}.`,
    '',
    'Outcome market',
    ...renderOutcomeMarket(report, market),
    '',
    'Selected pick edge',
    ...renderSelectedEdge(market),
    '',
    'How to interpret it',
    '- Positive edge means the agent gives that outcome more chance than the bookmaker-implied probability.',
    '- Negative edge means the market is more optimistic than the agent.',
    '- Normalized market probability removes bookmaker margin across home/draw/away, when enough data exists.',
    '- This is a cross-check, not a guarantee. Strong market disagreement should trigger review, not blind approval.',
    '',
    'Data quality',
    ...friendlyWarnings(market).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(market),
    '',
    `Saved report id: ${report.id}`,
    'Execution requires the Approve Plan button and all wallet safety guards.',
  ].join('\n');
}

function renderOutcomeMarket(report: DecisionReport, market: MarketOddsComparisonReport): string[] {
  const winner = market.markets.matchWinner;
  if (!winner) return ['- Match-winner odds are not available for this match.'];
  return [
    `- ${report.match.home}: agent ${formatPercent(winner.home.agentProbability)} vs market ${formatMarketProbability(winner.home)} (${formatEdge(winner.home)}).`,
    `- Draw: agent ${formatPercent(winner.draw.agentProbability)} vs market ${formatMarketProbability(winner.draw)} (${formatEdge(winner.draw)}).`,
    `- ${report.match.away}: agent ${formatPercent(winner.away.agentProbability)} vs market ${formatMarketProbability(winner.away)} (${formatEdge(winner.away)}).`,
    `- Bookmaker margin / overround: ${winner.overround === null ? 'not available' : formatPercent(winner.overround)}.`,
  ];
}

function renderSelectedEdge(market: MarketOddsComparisonReport): string[] {
  const outcome = market.selected.outcomeComparison;
  const exact = market.selected.exactScoreComparison;
  const lines: string[] = [];
  if (outcome) {
    lines.push(`- Selected outcome: agent ${formatPercent(outcome.agentProbability)} vs market ${formatMarketProbability(outcome)}.`);
    lines.push(`- Outcome edge: ${formatEdge(outcome)}; bookmaker: ${outcome.bookmaker ?? 'not available'}; decimal odds: ${formatDecimal(outcome.priceDecimal)}.`);
  } else {
    lines.push('- Selected outcome edge is unavailable.');
  }
  if (exact) {
    lines.push(`- Exact score ${market.selected.score.home}-${market.selected.score.away}: agent ${formatPercent(exact.agentProbability)} vs market ${formatMarketProbability(exact)}.`);
    lines.push(`- Exact-score edge: ${formatEdge(exact)}; bookmaker: ${exact.bookmaker ?? 'not available'}; decimal odds: ${formatDecimal(exact.priceDecimal)}.`);
  } else {
    lines.push('- Exact-score market is unavailable for the selected score.');
  }
  return lines;
}

function friendlySummary(market: MarketOddsComparisonReport): string {
  if (!market.providerConfigured) return 'Odds comparison is unavailable because no odds provider/manual snapshot is configured';
  const selected = market.selected.outcomeComparison;
  if (!selected || selected.edge === null) return 'The agent could not compare the selected outcome to bookmaker implied probability';
  if (selected.edgeDirection === 'positive') {
    return `The agent is more optimistic than the market by ${formatPercentagePointEdge(selected.edge)} on the selected outcome`;
  }
  if (selected.edgeDirection === 'negative') {
    return `The agent is less optimistic than the market by ${formatPercentagePointEdge(Math.abs(selected.edge))} on the selected outcome`;
  }
  return 'The agent and market are broadly aligned on the selected outcome';
}

function nextAction(market: MarketOddsComparisonReport): string {
  if (!market.providerConfigured) {
    return 'Configure `SMARTCUP_ODDS_MANUAL_JSON` or a future live odds provider, then rerun market comparison before using this as an edge check.';
  }
  const selected = market.selected.outcomeComparison;
  if (!selected || selected.edge === null) return 'Rerun with a match-winner odds snapshot that includes the selected outcome.';
  if (selected.edgeDirection === 'positive') {
    return 'Use this as supporting evidence only; still review team context, timing, and competitor analysis before approval.';
  }
  if (selected.edgeDirection === 'negative') {
    return 'Treat this as a caution flag. Consider safer or alternative picks before approval.';
  }
  return 'Market and agent agree closely; use points, timing, and leaderboard posture to decide whether to approve.';
}

function friendlyWarnings(market: MarketOddsComparisonReport): string[] {
  const friendlySourceWarnings = renderFriendlySourceWarningBullets(market.warnings, 5);
  const warnings = market.warnings.map((warning) => {
    const text = warning.toLowerCase();
    if (text.includes('not configured')) return 'No odds provider/manual snapshot is configured yet.';
    if (text.includes('no odds snapshots') || text.includes('matched')) return 'No odds snapshot matched this SmartCup match id.';
    if (text.includes('match-winner')) return 'Match-winner odds are incomplete for this selected outcome.';
    if (text.includes('exact-score')) return 'Exact-score odds are incomplete for this selected score.';
    return warning;
  });
  const combined = [...friendlySourceWarnings, ...warnings];
  if (combined.length === 0) return ['No major market-comparison warnings were detected.'];
  return [...new Set(combined)].slice(0, 5);
}

function formatMarketProbability(value: MarketComparisonProbability): string {
  if (value.marketNormalizedProbability !== null) return `${formatPercent(value.marketNormalizedProbability)} normalized`;
  if (value.marketImpliedProbability !== null) return `${formatPercent(value.marketImpliedProbability)} implied`;
  return 'not available';
}

function formatEdge(value: MarketComparisonProbability): string {
  if (value.edge === null) return 'edge unavailable';
  const sign = value.edge > 0 ? '+' : '';
  return `${sign}${formatPercentagePointEdge(value.edge)} ${edgeLabel(value.edgeDirection)}`;
}

function edgeLabel(value: MarketComparisonProbability['edgeDirection']): string {
  if (value === 'positive') return 'agent edge';
  if (value === 'negative') return 'market edge';
  if (value === 'neutral') return 'aligned';
  return 'unavailable';
}

function formatPercentagePointEdge(value: number): string {
  return `${(value * 100).toFixed(1)} percentage points`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDecimal(value: number | null): string {
  return value === null ? 'not available' : value.toFixed(2);
}

function outcomeLabel(outcome: PoolOutcome, home: string, away: string): string {
  if (outcome === 'home') return `${home} win`;
  if (outcome === 'away') return `${away} win`;
  return 'draw';
}
