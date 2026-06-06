import type { DecisionReport, TournamentPositionPosture, TournamentPositionStrategyReport } from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyTournamentPositionStrategy(report: DecisionReport): string {
  const position = report.sections?.tournamentPositionStrategy;
  if (!position) {
    return [
      'Tournament-position strategy',
      'Read-only analysis. No report was saved and no transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Tournament-position strategy is not available for this report.',
      '',
      'Next action',
      'Run a fresh single-match prediction preview before approving anything.',
    ].join('\n');
  }

  return [
    'Tournament-position strategy',
    'Read-only analysis. No report was saved and no transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Pick context: ${report.selected.score.home}-${report.selected.score.away} ${outcomeLabel(report.selected.outcome)}.`,
    '',
    'Recommended posture',
    `- ${postureLabel(position.selectedPosture)}.`,
    `- Recommended risk mode: ${formatMode(position.recommendedRiskMode)}.`,
    `- Recommended simulation objective: ${formatMode(position.recommendedObjective)}.`,
    `- Confidence: ${position.confidence}.`,
    `- ${position.recommendation}`,
    '',
    'Leaderboard context',
    `- Ranking source: ${rankingSourceLabel(position.rankingSource)}.`,
    `- Current rank: ${position.currentRank === null ? 'not ranked' : `#${position.currentRank}`} of ${position.totalRankedWallets}.`,
    `- Current points: ${position.currentPoints}.`,
    `- Behind leader: ${formatGap(position.pointsBehindLeader)}.`,
    `- Behind next rank: ${formatGap(position.pointsBehindNextRank)}.`,
    `- Ahead of next rank: ${formatGap(position.pointsAheadNextRank)}.`,
    `- Top-five gap: ${formatGap(position.pointsBehindTopFive)}.`,
    `- Top-five cushion: ${formatGap(position.pointsAheadSixth)}.`,
    `- Match phase: ${position.phase} x${position.phaseWeight}.`,
    '',
    'Posture guide',
    `- Leading: ${postureGuide('leading')}`,
    `- Mid-table: ${postureGuide('mid_table')}`,
    `- Catch-up: ${postureGuide('catch_up')}`,
    `- Final swing: ${postureGuide('final_swing')}`,
    '',
    'Why',
    ...position.rationale.slice(0, 5).map((line) => `- ${line}`),
    '',
    'Signals',
    ...friendlySignals(position).map((line) => `- ${line}`),
    '',
    'Data quality',
    ...friendlyWarnings(position).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(position),
  ].join('\n');
}

function postureLabel(posture: TournamentPositionPosture): string {
  if (posture === 'leading') return 'Protect the lead';
  if (posture === 'catch_up') return 'Catch up';
  if (posture === 'final_swing') return 'Final swing';
  return 'Stay balanced';
}

function postureGuide(posture: TournamentPositionPosture): string {
  if (posture === 'leading') return 'favor safer, rank-protecting picks unless the points EV is overwhelming.';
  if (posture === 'catch_up') return 'accept controlled upside when the gap is reachable.';
  if (posture === 'final_swing') return 'seek differentiated high-upside scores when late phase weight or rank gap demands it.';
  return 'balance points, payout, and leaderboard equity while the rank gap is unclear.';
}

function nextAction(position: TournamentPositionStrategyReport): string {
  if (position.selectedPosture === 'leading') {
    return 'Use Protect Lead only if the rank context is reliable; otherwise refresh leaderboard data before approving.';
  }
  if (position.selectedPosture === 'catch_up') {
    return 'Run competitor analysis before approving a catch-up pick, then preview the exact match recommendation.';
  }
  if (position.selectedPosture === 'final_swing') {
    return 'Use final-swing only for high-leverage moments; refresh source data and competitor analysis before approval.';
  }
  return 'Keep balanced settings unless a later leaderboard refresh shows a clearer lead or catch-up gap.';
}

function friendlySignals(position: TournamentPositionStrategyReport): string[] {
  const important = position.signals
    .filter((signal) => signal.severity !== 'low')
    .slice(0, 5);
  if (important.length === 0) return ['No strong rank-pressure signals were detected.'];
  return important.map((signal) => `${signal.label}: ${postureLabel(signal.posture)} (${signal.severity}). ${signal.detail}`);
}

function friendlyWarnings(position: TournamentPositionStrategyReport): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(position.warnings, 5));
  for (const warning of position.warnings) {
    const text = warning.toLowerCase();
    if (text.includes('user_points') || text.includes('profile leaderboard')) {
      categories.add('Leaderboard data is provisional; refresh before treating this as a final strategy posture.');
    } else if (text.includes('tiny')) {
      categories.add('The leaderboard sample is tiny, so posture can swing after a few new predictions or results.');
    } else if (text.includes('wallet')) {
      categories.add('The configured wallet was not fully visible in rank data; posture is approximate.');
    } else {
      categories.add(warning);
    }
  }
  if (categories.size === 0) categories.add('No major tournament-position warnings were detected.');
  return [...categories].slice(0, 5);
}

function rankingSourceLabel(value: TournamentPositionStrategyReport['rankingSource']): string {
  if (value === 'chain_user_points') return 'live chain user_points';
  if (value === 'profile_leaderboard_fallback') return 'SmartCup profile/API fallback, provisional';
  return 'unavailable';
}

function formatGap(value: number | null): string {
  return value === null ? 'not available' : `${value} point${value === 1 ? '' : 's'}`;
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function outcomeLabel(value: string): string {
  if (value === 'home') return 'home win';
  if (value === 'away') return 'away win';
  return 'draw';
}
