import type { AnalysisProductKey, DecisionReport, RiskMode } from '../types/index.js';
import {
  buildSharedAnalysisReportRender,
  type SharedAnalysisReport,
} from './shared-report-builder.js';

export type PersonalReportExportFormat = 'markdown' | 'json';

export type PersonalReportExportInput = {
  decisions: DecisionReport[];
  format: PersonalReportExportFormat;
  decisionId?: string | undefined;
  matchId?: string | undefined;
  tournamentId?: string | undefined;
  riskMode?: RiskMode | undefined;
  limit?: number | undefined;
};

export type PersonalReportExport = {
  format: PersonalReportExportFormat;
  product: AnalysisProductKey;
  selectedDecisionIds: string[];
  text: string;
  report: SharedAnalysisReport;
};

export type PersonalSavedReportProduct = 'single_match';

export type PersonalSavedReportLookupInput = {
  decisions: DecisionReport[];
  decisionId?: string | undefined;
  matchId?: string | undefined;
  tournamentId?: string | undefined;
  product?: PersonalSavedReportProduct | undefined;
  riskMode?: RiskMode | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  limit?: number | undefined;
};

export type PersonalSavedReportLookupRow = {
  id: string;
  product: PersonalSavedReportProduct;
  generatedAt: string;
  tournamentId: string;
  tournamentName: string;
  matchId: string;
  matchLabel: string;
  phase: string;
  phaseWeight: number;
  riskMode: RiskMode;
  selectedScore: string;
  selectedOutcome: string;
  confidenceLabel: DecisionReport['summary']['confidenceLabel'];
  expectedWeightedPoints: number | null;
  expectedRoi: number | null;
  sourceWarningCount: number;
};

export type PersonalSavedReportLookup = {
  generatedAt: string;
  filters: {
    decisionId: string | null;
    matchId: string | null;
    tournamentId: string | null;
    product: PersonalSavedReportProduct | null;
    riskMode: RiskMode | null;
    dateFrom: string | null;
    dateTo: string | null;
    limit: number;
  };
  totalMatched: number;
  reports: PersonalSavedReportLookupRow[];
  notes: string[];
};

export function buildPersonalReportExport(input: PersonalReportExportInput): PersonalReportExport {
  const selected = selectPersonalExportDecisions(input);
  const product: AnalysisProductKey = selected.length > 1 ? 'five_match_bundle' : 'single_match';
  const render = buildSharedAnalysisReportRender({
    product,
    pillar: 'personal_operator',
    visibility: 'personal',
    decisions: selected,
  });

  return {
    format: input.format,
    product,
    selectedDecisionIds: selected.map((decision) => decision.id),
    text: input.format === 'markdown' ? render.markdown : render.json,
    report: render.report,
  };
}

export function renderPersonalReportExportSummary(exported: PersonalReportExport): string {
  return [
    'Personal report export',
    `Format: ${exported.format}`,
    `Product: ${exported.product}`,
    `DecisionReports: ${exported.selectedDecisionIds.join(', ')}`,
    `Matches: ${exported.report.matchIds.join(', ') || 'n/a'}`,
    `Source warnings: ${exported.report.sourceWarningCount}`,
  ].join('\n');
}

export function buildPersonalSavedReportLookup(
  input: PersonalSavedReportLookupInput,
): PersonalSavedReportLookup {
  const dateFromMs = parseDateBoundary(input.dateFrom, 'from');
  const dateToMs = parseDateBoundary(input.dateTo, 'to');
  const limit = normalizeLimit(input.limit ?? 20);
  const sorted = [...input.decisions].sort(
    (left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt),
  );
  const filtered = sorted
    .filter((decision) => !input.decisionId || decision.id === input.decisionId)
    .filter((decision) => !input.matchId || decision.matchId === input.matchId)
    .filter((decision) => !input.tournamentId || decision.tournament.id === input.tournamentId)
    .filter((decision) => !input.product || input.product === 'single_match')
    .filter((decision) => !input.riskMode || decision.riskMode === input.riskMode)
    .filter((decision) => {
      const generatedAtMs = Date.parse(decision.generatedAt);
      if (!Number.isFinite(generatedAtMs)) return false;
      if (dateFromMs !== null && generatedAtMs < dateFromMs) return false;
      if (dateToMs !== null && generatedAtMs > dateToMs) return false;
      return true;
    });

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      decisionId: input.decisionId ?? null,
      matchId: input.matchId ?? null,
      tournamentId: input.tournamentId ?? null,
      product: input.product ?? null,
      riskMode: input.riskMode ?? null,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
      limit,
    },
    totalMatched: filtered.length,
    reports: filtered.slice(0, limit).map(decisionToLookupRow),
    notes: [
      'Saved personal lookup currently indexes durable DecisionReport records.',
      'Personal 5-match bundles appear as one single-match DecisionReport per match until bundle artifacts are persisted separately.',
      'Podium strategy and tournament advisory lookup will use their own saved personal artifact tables once those reports are persisted.',
    ],
  };
}

export function renderPersonalSavedReportLookupSummary(lookup: PersonalSavedReportLookup): string {
  return [
    'Saved personal reports',
    `Generated: ${lookup.generatedAt}`,
    `Matched: ${lookup.totalMatched}`,
    `Showing: ${lookup.reports.length}`,
    renderLookupFilterLine(lookup),
    '',
    ...(lookup.reports.length
      ? lookup.reports.map(
          (report, index) =>
            `${index + 1}. ${report.id} | ${report.product} | ${report.tournamentId} | match #${report.matchId} ${report.matchLabel} | ${report.selectedScore} ${report.selectedOutcome} | risk ${report.riskMode} | ${report.generatedAt}`,
        )
      : ['No saved personal reports matched these filters.']),
    '',
    ...lookup.notes.map((note) => `Note: ${note}`),
  ].join('\n');
}

function selectPersonalExportDecisions(input: PersonalReportExportInput): DecisionReport[] {
  const sorted = [...input.decisions].sort(
    (left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt),
  );
  const filtered = sorted
    .filter((decision) => !input.decisionId || decision.id === input.decisionId)
    .filter((decision) => !input.matchId || decision.matchId === input.matchId)
    .filter((decision) => !input.tournamentId || decision.tournament.id === input.tournamentId)
    .filter((decision) => !input.riskMode || decision.riskMode === input.riskMode);

  if (filtered.length === 0) {
    throw new Error(
      [
        'No saved personal DecisionReport matched the export filters.',
        input.decisionId ? `decision=${input.decisionId}` : null,
        input.matchId ? `match=${input.matchId}` : null,
        input.tournamentId ? `tournament=${input.tournamentId}` : null,
        input.riskMode ? `risk=${input.riskMode}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join(' '),
    );
  }

  const limit = normalizeLimit(input.limit ?? (input.decisionId || input.matchId ? 1 : 5));
  return filtered.slice(0, limit).reverse();
}

function decisionToLookupRow(decision: DecisionReport): PersonalSavedReportLookupRow {
  return {
    id: decision.id,
    product: 'single_match',
    generatedAt: decision.generatedAt,
    tournamentId: decision.tournament.id,
    tournamentName: decision.tournament.name,
    matchId: decision.matchId,
    matchLabel: `${decision.match.home} vs ${decision.match.away}`,
    phase: decision.tournament.phase,
    phaseWeight: decision.tournament.phaseWeight,
    riskMode: decision.riskMode,
    selectedScore: `${decision.selected.score.home}-${decision.selected.score.away}`,
    selectedOutcome: decision.selected.outcome,
    confidenceLabel: decision.summary.confidenceLabel,
    expectedWeightedPoints: decision.economics.expectedWeightedPoints,
    expectedRoi: decision.economics.expectedRoi,
    sourceWarningCount: decision.sourceWarnings.length,
  };
}

function renderLookupFilterLine(lookup: PersonalSavedReportLookup): string {
  const filters = [
    lookup.filters.decisionId ? `decision=${lookup.filters.decisionId}` : null,
    lookup.filters.matchId ? `match=${lookup.filters.matchId}` : null,
    lookup.filters.tournamentId ? `tournament=${lookup.filters.tournamentId}` : null,
    lookup.filters.product ? `product=${lookup.filters.product}` : null,
    lookup.filters.riskMode ? `risk=${lookup.filters.riskMode}` : null,
    lookup.filters.dateFrom ? `from=${lookup.filters.dateFrom}` : null,
    lookup.filters.dateTo ? `to=${lookup.filters.dateTo}` : null,
    `limit=${lookup.filters.limit}`,
  ].filter((filter): filter is string => filter !== null);
  return `Filters: ${filters.join(', ')}`;
}

function parseDateBoundary(value: string | undefined, side: 'from' | 'to'): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid date ${side}: ${value}`);
  if (side === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parsed + 86_399_999;
  return parsed;
}

function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) return 1;
  return Math.min(limit, 25);
}
