import type { ExecutionMode } from '../types/index.js';

export type FriendlyAgentStatusReport = {
  tournament: {
    name: string;
    id: string | null;
  };
  account: {
    accountName: string;
    nickname: string;
    wallet: string;
    ss58: string;
    balance: string;
  };
  stats: {
    rank: number | null;
    rankSource: 'chain' | 'smartcup_api' | 'none';
    points: number;
    predictionCount: number;
    evaluated: number;
    pending: number;
    exactHits: number;
    outcomeHits: number;
    awardedWeightedPoints: number;
    behindNext: number | null;
    aheadOfNext: number | null;
  };
  execution: {
    policyMode: ExecutionMode;
    readyForAutonomousWrites: boolean;
  };
  notes: string[];
};

export function renderFriendlyAgentStatus(report: FriendlyAgentStatusReport): string {
  return [
    'Agent status',
    'Read-only status. No transaction was submitted.',
    '',
    'Connected account',
    `- Agent account: ${report.account.accountName}.`,
    `- SmartCup nickname: ${report.account.nickname}.`,
    `- Wallet: ${report.account.wallet}.`,
    `- SS58: ${report.account.ss58}.`,
    `- Balance: ${report.account.balance}.`,
    '',
    'Active tournament',
    `- ${report.tournament.name}.`,
    report.tournament.id ? `- Tournament ID: ${report.tournament.id}.` : '- Tournament ID: not available.',
    '',
    'Tournament progress',
    `- Position: ${rankLabel(report)}.`,
    `- Points: ${report.stats.points}.`,
    `- Rank gap: ${rankGapLabel(report)}.`,
    `- Predictions to date: ${report.stats.predictionCount}.`,
    `- Evaluated results: ${report.stats.evaluated}; pending results: ${report.stats.pending}.`,
    `- Exact hits: ${report.stats.exactHits}; outcome hits: ${report.stats.outcomeHits}.`,
    `- Awarded weighted points: ${report.stats.awardedWeightedPoints}.`,
    '',
    'Execution safety',
    `- Current policy: ${formatMode(report.execution.policyMode)}.`,
    report.execution.readyForAutonomousWrites
      ? '- Autonomous writes are marked ready, but live execution still depends on explicit guards.'
      : '- Auto-prediction is not enabled.',
    '- Approval-required execution still needs the normal Approve Plan button and all wallet guards.',
    '',
    'Data notes',
    ...dataNotes(report).map((note) => `- ${note}`),
    '',
    'Next action',
    nextAction(report),
  ].join('\n');
}

function rankLabel(report: FriendlyAgentStatusReport): string {
  if (report.stats.rank === null) return 'not ranked yet';
  const suffix = report.stats.rankSource === 'smartcup_api' ? 'profile leaderboard, provisional' : 'live chain points';
  return `#${report.stats.rank} (${suffix})`;
}

function rankGapLabel(report: FriendlyAgentStatusReport): string {
  if (report.stats.rank === 1 && report.stats.aheadOfNext !== null) {
    return `${report.stats.aheadOfNext} point${report.stats.aheadOfNext === 1 ? '' : 's'} ahead of the next competitor`;
  }
  if (report.stats.behindNext !== null) {
    return `${report.stats.behindNext} point${report.stats.behindNext === 1 ? '' : 's'} behind the next rank`;
  }
  return 'not available yet';
}

function dataNotes(report: FriendlyAgentStatusReport): string[] {
  const notes = [...report.notes];
  if (notes.length === 0) notes.push('No major status warnings were detected.');
  return [...new Set(notes)].slice(0, 5);
}

function nextAction(report: FriendlyAgentStatusReport): string {
  if (report.stats.rank === null) return 'Generate predictions and refresh leaderboard data after results finalize.';
  if (report.stats.pending > 0) return 'Evaluate pending results after final scores are available, then rerun status and calibration.';
  return 'Use Predict for a fresh preview or Reports for saved decisions and calibration.';
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
