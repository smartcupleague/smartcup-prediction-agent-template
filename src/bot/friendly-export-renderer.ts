import type {
  PersonalReportExport,
  PersonalReportExportFormat,
} from '../reports/personal-report-export.js';
import type { TournamentProfileOption } from '../tournament/index.js';

export function renderFriendlyExportPrompt(tournament: TournamentProfileOption): string {
  return [
    'Export saved reports',
    'Read-only export. No transaction will be submitted and no external-service request will be created.',
    '',
    `Tournament: ${tournament.name}`,
    `Tournament ID: ${tournament.tournamentId}`,
    '',
    'Choose a format',
    '- Markdown: best for sharing with yourself, saving notes, or reviewing in a document.',
    '- JSON: best for audit, debugging, automation, or importing into another tool.',
    '',
    'What gets exported',
    '- The latest saved personal DecisionReports for this tournament.',
    '- Raw model/audit fields stay in the export, but Telegram keeps this prompt short.',
    '- If you need one specific report, first copy its report id from Saved Decisions.',
    '',
    'Safety',
    'Exports are records only. They cannot approve or submit wallet transactions.',
  ].join('\n');
}

export function renderFriendlyExportCompletion(exported: PersonalReportExport): string {
  return [
    'Export ready',
    `Format: ${formatLabel(exported.format)}.`,
    `Product scope: ${formatProduct(exported.product)}.`,
    `DecisionReports exported: ${exported.selectedDecisionIds.length}.`,
    `Report ids: ${exported.selectedDecisionIds.join(', ') || 'none'}.`,
    `Matches: ${exported.report.matchIds.join(', ') || 'not available'}.`,
    `Source warnings across export: ${exported.report.sourceWarningCount}.`,
    '',
    'How to use it',
    exported.format === 'markdown'
      ? '- Markdown is human-readable. Keep it as your review note or copy it into a document.'
      : '- JSON is machine-readable. Use it for audit, debugging, or another app.',
    '- Re-run the prediction preview before approving any old recommendation.',
    '- Exporting does not create a transaction plan.',
  ].join('\n');
}

export function renderFriendlyExportContentHeader(format: PersonalReportExportFormat): string {
  return format === 'markdown' ? 'Markdown export content' : 'JSON export content';
}

export function renderFriendlyExportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const missingReport = /not found|no saved|missing|empty/i.test(message);
  return [
    'Could not export saved personal reports.',
    missingReport
      ? 'No saved personal DecisionReport matched the requested export filter.'
      : 'The export hit an internal read/write problem.',
    '',
    'Next action',
    missingReport
      ? 'Open Saved Decisions to confirm which report ids and tournaments are available, then export again.'
      : 'Try again once. If it repeats, use Saved Decisions to confirm the report id before exporting.',
  ].join('\n');
}

export function renderFriendlyExportUnavailable(input: {
  tournamentName: string;
  tournamentId: string;
  totalSavedReports: number;
  tournamentSavedReports: number;
  storage?: {
    sqlitePath: string;
    runningOnRender: boolean;
    likelyEphemeralOnRender: boolean;
  } | undefined;
}): string {
  const noReportsAtAll = input.totalSavedReports === 0;
  const storageLines = input.storage
    ? [
        '',
        'Storage check',
        `- SQLite memory path: ${input.storage.sqlitePath}.`,
        input.storage.likelyEphemeralOnRender
          ? '- Render durability: not configured. Saved reports can disappear after worker restarts or redeploys.'
          : input.storage.runningOnRender
            ? '- Render durability: storage path looks persistent.'
            : '- Render durability: not applicable; this looks like a local bot instance.',
      ]
    : [];
  return [
    'Could not export saved personal reports.',
    noReportsAtAll
      ? 'This bot instance does not have any saved personal DecisionReports yet.'
      : `Saved DecisionReports exist, but none matched the selected tournament: ${input.tournamentName}.`,
    '',
    'What I checked',
    `- Total saved DecisionReports visible to this bot: ${input.totalSavedReports}.`,
    `- Saved DecisionReports for ${input.tournamentId}: ${input.tournamentSavedReports}.`,
    ...storageLines,
    '',
    'Next action',
    input.storage?.likelyEphemeralOnRender
      ? 'Attach a Render persistent disk and set SMARTPREDICTOR_SQLITE_PATH=/var/data/smartcup-agent.memory.sqlite, then generate a fresh personal prediction preview.'
      : noReportsAtAll
        ? 'Generate a personal prediction preview first, then return to Reports -> Export Report.'
        : 'Open Saved Decisions for this tournament, or use Change Tournament before exporting.',
  ].join('\n');
}

function formatLabel(format: PersonalReportExportFormat): string {
  return format === 'markdown' ? 'Markdown' : 'JSON';
}

function formatProduct(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
