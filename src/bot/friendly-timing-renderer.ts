import type { DecisionReport, TimingStrategyRecommendation, TimingStrategyReport } from '../types/index.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export function renderFriendlyTimingStrategy(report: DecisionReport): string {
  const timing = report.sections?.timingStrategy;
  if (!timing) {
    return [
      'Timing strategy',
      'Read-only analysis. No report was saved and no transaction was submitted.',
      '',
      `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
      'Timing strategy is not available for this report.',
      '',
      'Next action',
      'Run a fresh single-match prediction preview before approving anything.',
    ].join('\n');
  }

  return [
    'Timing strategy',
    'Read-only analysis. No report was saved and no transaction was submitted.',
    '',
    `Match #${report.matchId}: ${report.match.home} vs ${report.match.away}`,
    `Current pick context: ${report.selected.score.home}-${report.selected.score.away} ${outcomeLabel(report.selected.outcome)}.`,
    `Recommendation: ${recommendationLabel(timing.recommendation)}.`,
    `Confidence: ${timing.confidence}.`,
    '',
    'Timing window',
    `- Kickoff: ${timing.kickoffAt}.`,
    `- SmartCup prediction cutoff: ${timing.predictionCutoffAt}.`,
    `- Agent safety close: ${timing.agentSafetyCloseAt}.`,
    `- Time until safety close: ${formatMinutes(timing.minutesUntilAgentSafetyClose)}.`,
    timing.nextReviewAt ? `- Suggested next review: ${timing.nextReviewAt}.` : '- Suggested next review: none.',
    '',
    'Why',
    ...timing.rationale.slice(0, 4).map((line) => `- ${line}`),
    '',
    'Data quality',
    `- Source quality: ${sourceQualityLabel(timing.sourceQuality)}.`,
    `- Data volatility: ${volatilityLabel(timing.dataVolatility)}.`,
    ...friendlySignals(timing).map((line) => `- ${line}`),
    ...friendlyWarnings(timing).map((line) => `- ${line}`),
    '',
    'Next action',
    nextAction(timing),
  ].join('\n');
}

function recommendationLabel(value: TimingStrategyRecommendation): string {
  if (value === 'predict_now') return 'predict now is acceptable, but approval still needs all wallet safety guards';
  if (value === 'wait') return 'wait and refresh before approving';
  return 'blocked by cutoff or safety window; do not submit';
}

function nextAction(timing: TimingStrategyReport): string {
  if (timing.recommendation === 'blocked_by_cutoff') {
    return 'Do not approve this match from the current report. The timing guard should block live execution.';
  }
  if (timing.recommendation === 'wait') {
    return `Wait, then rerun the prediction preview${timing.nextReviewAt ? ` around ${timing.nextReviewAt}` : ' before the safety close'}.`;
  }
  return 'Run or review the single-match prediction preview, then approve only if duplicate, cutoff, balance, exposure, and policy guards pass.';
}

function friendlySignals(timing: TimingStrategyReport): string[] {
  const important = timing.signals
    .filter((signal) => signal.severity !== 'low' || signal.direction === 'blocked')
    .slice(0, 4);
  if (important.length === 0) return ['No high-pressure timing signals were detected.'];
  return important.map((signal) => `${signal.label}: ${signalText(signal.direction)} (${signal.severity}). ${signal.detail}`);
}

function friendlyWarnings(timing: TimingStrategyReport): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(timing.warnings, 5));
  for (const warning of timing.warnings) {
    const text = warning.toLowerCase();
    if (text.includes('cutoff')) categories.add('Cutoff timing needs a fresh check before approval.');
    else if (text.includes('source')) categories.add('Source quality is degraded; refresh before relying on timing.');
  }
  return [...categories].slice(0, 4);
}

function signalText(value: string): string {
  if (value === 'predict_now') return 'supports predicting now';
  if (value === 'wait') return 'supports waiting';
  if (value === 'blocked') return 'blocks approval';
  return 'neutral';
}

function sourceQualityLabel(value: TimingStrategyReport['sourceQuality']): string {
  if (value === 'healthy') return 'healthy';
  if (value === 'partial') return 'partial; usable with caution';
  return 'degraded; refresh recommended';
}

function volatilityLabel(value: TimingStrategyReport['dataVolatility']): string {
  if (value === 'high') return 'high; lineup/news/crowd movement can still change the recommendation';
  if (value === 'medium') return 'medium; refresh if new information appears';
  return 'low; timing risk is relatively stable';
}

function outcomeLabel(value: string): string {
  if (value === 'home') return 'home win';
  if (value === 'away') return 'away win';
  return 'draw';
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 0) return `${Math.abs(Math.round(value))} minutes past safety close`;
  if (value < 120) return `${Math.round(value)} minutes`;
  return `${(value / 60).toFixed(1)} hours`;
}
