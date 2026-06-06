import type {
  PersonalSavedReportLookup,
  PersonalSavedReportLookupRow,
} from '../reports/personal-report-export.js';

export function renderFriendlySavedReportLookup(lookup: PersonalSavedReportLookup): string {
  return [
    'Saved personal reports',
    'Read-only lookup. No transaction was submitted and no external-service request was created.',
    '',
    'Scope',
    `- Tournament: ${lookup.filters.tournamentId ?? 'all tournaments'}.`,
    `- Match: ${lookup.filters.matchId ?? 'all matches'}.`,
    `- Risk mode: ${lookup.filters.riskMode ?? 'all risk modes'}.`,
    `- Date range: ${formatDateRange(lookup)}.`,
    `- Matched ${lookup.totalMatched}; showing ${lookup.reports.length}.`,
    '',
    lookup.reports.length ? 'Latest saved reports' : 'Latest saved reports',
    ...reportLines(lookup.reports),
    '',
    'How to use this',
    '- Tap one of the report buttons below to open the full saved report.',
    '- Use the latest report only if it matches the tournament, match, and risk mode you intend to act on.',
    '- Approval and manual score buttons appear only after you open one report.',
    '- Saved reports are audit records; approval still needs an explicit button and all wallet safety gates.',
    '',
    'Notes',
    ...friendlyNotes(lookup).map((note) => `- ${note}`),
    '',
    'Next action',
    nextAction(lookup),
  ].join('\n');
}

function reportLines(reports: PersonalSavedReportLookupRow[]): string[] {
  if (reports.length === 0) {
    return [
      '- No saved personal reports matched these filters.',
      '- Generate a personal Single Match preview or 5-Match Bundle to create DecisionReports.',
    ];
  }

  return reports.map((report, index) => {
    const sourceWarningLabel =
      report.sourceWarningCount === 0
        ? 'no source warnings'
        : `${report.sourceWarningCount} source warning${report.sourceWarningCount === 1 ? '' : 's'}`;
    return [
      `${index + 1}. ${report.matchLabel} (#${report.matchId})`,
      `   - Report id: ${report.id}`,
      `   - Pick: ${report.selectedScore} ${outcomeLabel(report.selectedOutcome)}; risk: ${formatMode(report.riskMode)}; confidence: ${report.confidenceLabel}.`,
      `   - Tournament: ${report.tournamentName}; phase ${report.phase} x${report.phaseWeight}.`,
      `   - Expected points: ${formatPoints(report.expectedWeightedPoints)}; payout ROI: ${formatRoi(report.expectedRoi)}; ${sourceWarningLabel}.`,
      `   - Saved: ${report.generatedAt}.`,
    ].join('\n');
  });
}

function friendlyNotes(lookup: PersonalSavedReportLookup): string[] {
  const notes = lookup.notes.map((note) => {
    if (note.includes('DecisionReport')) {
      return 'This list currently indexes saved DecisionReports from personal prediction previews.';
    }
    if (note.includes('5-match')) {
      return 'A personal 5-match bundle appears as five separate per-match saved reports.';
    }
    if (note.includes('Podium') || note.includes('tournament advisory')) {
      return 'Podium and tournament advisory artifacts will get separate lookup rows once persisted as dedicated artifacts.';
    }
    return note;
  });
  return [...new Set(notes)].slice(0, 4);
}

function nextAction(lookup: PersonalSavedReportLookup): string {
  if (lookup.reports.length === 0) {
    return 'Create a fresh personal prediction preview, then return here to list or export it.';
  }
  const latest = lookup.reports[0];
  if (!latest) return 'Create a fresh personal prediction preview, then return here to list or export it.';
  return `Open the saved report you want to inspect. To export the latest listed report, use Export Report and choose report id ${latest.id}.`;
}

function formatDateRange(lookup: PersonalSavedReportLookup): string {
  if (!lookup.filters.dateFrom && !lookup.filters.dateTo) return 'all dates';
  if (lookup.filters.dateFrom && lookup.filters.dateTo) return `${lookup.filters.dateFrom} to ${lookup.filters.dateTo}`;
  if (lookup.filters.dateFrom) return `from ${lookup.filters.dateFrom}`;
  return `until ${lookup.filters.dateTo}`;
}

function outcomeLabel(value: string): string {
  if (value === 'home') return 'home win';
  if (value === 'away') return 'away win';
  return 'draw';
}

function formatPoints(value: number | null): string {
  if (value === null) return 'not available';
  return `${value.toFixed(2)} weighted points`;
}

function formatRoi(value: number | null): string {
  if (value === null) return 'not available';
  return `${(value * 100).toFixed(1)}%`;
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
