import type {
  DecisionReport,
  PostMatchCalibrationEntry,
  PostMatchCalibrationReport,
  StoredOutcomeEvaluation,
  StoredPrediction,
} from '../types/index.js';
import type { TournamentProfileOption } from '../tournament/index.js';

export type FriendlyPredictionHistoryInput = {
  tournament: TournamentProfileOption;
  predictions: StoredPrediction[];
  decisions: DecisionReport[];
  evaluations: StoredOutcomeEvaluation[];
};

export function renderFriendlyPredictionHistory(input: FriendlyPredictionHistoryInput): string {
  const evaluated = input.evaluations.filter((evaluation) => evaluation.status === 'evaluated');
  const pending = input.evaluations.filter((evaluation) => evaluation.status === 'pending');
  const exactHits = evaluated.filter((evaluation) => {
    const actual = evaluation.actual.score;
    return Boolean(actual && actual.home === evaluation.predicted.score.home && actual.away === evaluation.predicted.score.away);
  }).length;
  const outcomeHits = evaluated.filter((evaluation) => evaluation.actual.outcome === evaluation.predicted.outcome).length;
  const manualOrImported = input.predictions.filter(
    (prediction) => prediction.source === 'manual' || prediction.source === 'imported_chain',
  ).length;
  const latestPredictions = [...input.predictions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const latestDecisions = [...input.decisions].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 6);

  return [
    'Prediction history',
    'Read-only history. No transaction was submitted and no external-service request was created.',
    '',
    `Tournament: ${input.tournament.name}`,
    `Tournament ID: ${input.tournament.tournamentId}`,
    '',
    'Snapshot',
    `- Local prediction records: ${input.predictions.length}.`,
    `- Manual/imported chain records: ${manualOrImported}.`,
    `- Saved DecisionReports for this tournament: ${input.decisions.length}.`,
    `- Outcome evaluations for this tournament: ${input.evaluations.length}.`,
    `- Pending evaluations: ${pending.length}; finalized/evaluated: ${evaluated.length}.`,
    `- Exact hits: ${exactHits}/${evaluated.length}; outcome hits: ${outcomeHits}/${evaluated.length}.`,
    '',
    'Latest local predictions',
    ...latestPredictionLines(latestPredictions),
    '',
    'Latest saved decision reports',
    ...latestDecisionLines(latestDecisions),
    '',
    'How to read this',
    '- Local predictions are the wallet prediction mirror stored in this bot instance.',
    '- That mirror is populated by explicit chain sync/reconciliation; saved recommendations alone do not count as submitted predictions.',
    '- Saved DecisionReports are model recommendations; they are not proof of submitted transactions.',
    '- Evaluations update only after a match result is finalized and the agent runs evaluation.',
    '',
    'Next action',
    nextHistoryAction(input.decisions.length, pending.length, evaluated.length),
  ].join('\n');
}

export function renderFriendlyPostMatchCalibration(report: PostMatchCalibrationReport): string {
  return [
    'Post-match calibration',
    'Read-only calibration. No transaction was submitted and no external-service request was created.',
    '',
    'Scope',
    `- Tournament: ${report.filters.tournamentId ?? 'all tournaments'}.`,
    `- Match: ${report.filters.matchId ?? 'all matches'}.`,
    `- Evaluated sample: ${report.sampleSize}.`,
    '',
    'Accuracy snapshot',
    `- Exact-score hits: ${report.exactHits}/${report.sampleSize} (${formatPercent(report.exactHitRate)}).`,
    `- Outcome hits: ${report.outcomeHits}/${report.sampleSize} (${formatPercent(report.outcomeHitRate)}).`,
    `- Average predicted exact-score chance: ${formatPercent(report.averagePredictedExactProbability)}.`,
    `- Average probability assigned to actual outcome: ${formatPercent(report.averagePredictedProbabilityForActualOutcome)}.`,
    '',
    'Model scoring',
    `- Average Brier score: ${formatMetric(report.averageBrierScore)}. Lower is better; 0 is perfect.`,
    `- Average log loss: ${formatMetric(report.averageLogLoss)}. Lower is better; large values mean the model was surprised.`,
    `- Average confidence: ${formatPercent(report.averageConfidence)}.`,
    `- Average source quality: ${report.averageSourceQualityScore === null ? 'not available' : `${report.averageSourceQualityScore.toFixed(1)}/100`}.`,
    '',
    'Points result',
    `- Average awarded weighted points: ${formatNullableNumber(report.averageAwardedWeightedPoints)}.`,
    `- Average expected weighted points: ${formatNullableNumber(report.averageExpectedWeightedPoints)}.`,
    `- Average points delta: ${formatNullableNumber(report.pointsDelta)}.`,
    '',
    'Recent evaluated decisions',
    ...calibrationEntryLines(report.entries.slice(0, 6)),
    '',
    'Model update notes',
    ...friendlyModelNotes(report).map((note) => `- ${note}`),
    '',
    'Warnings',
    ...friendlyCalibrationWarnings(report).map((warning) => `- ${warning}`),
    '',
    'Next action',
    nextCalibrationAction(report),
  ].join('\n');
}

function latestPredictionLines(predictions: StoredPrediction[]): string[] {
  if (predictions.length === 0) return ['- No local prediction records yet.'];
  return predictions.map(
    (prediction, index) =>
      `${index + 1}. Match #${prediction.matchId}: ${scoreText(prediction.score)} ${outcomeLabel(prediction.predictedOutcome)}; source ${sourceLabel(prediction.source)}; saved ${prediction.createdAt}.`,
  );
}

function latestDecisionLines(decisions: DecisionReport[]): string[] {
  if (decisions.length === 0) return ['- No saved DecisionReports for this tournament yet.'];
  return decisions.map(
    (decision, index) =>
      `${index + 1}. Match #${decision.matchId}: ${scoreText(decision.selected.score)} ${outcomeLabel(decision.selected.outcome)}; ${formatMode(decision.riskMode)} risk; confidence ${decision.summary.confidenceLabel}; report id ${decision.id}.`,
  );
}

function calibrationEntryLines(entries: PostMatchCalibrationEntry[]): string[] {
  if (entries.length === 0) return ['- No finalized evaluated decisions yet.'];
  return entries.map((entry, index) => {
    const result = entry.exactHit ? 'exact hit' : entry.outcomeHit ? 'outcome hit' : 'miss';
    return `${index + 1}. Match #${entry.matchId}: predicted ${scoreText(entry.predictedScore)} ${outcomeLabel(entry.predictedOutcome)}, actual ${scoreText(entry.actualScore)} ${outcomeLabel(entry.actualOutcome)}; ${result}; p(actual outcome) ${formatPercent(entry.predictedProbabilityForActualOutcome)}.`;
  });
}

function friendlyModelNotes(report: PostMatchCalibrationReport): string[] {
  if (report.modelUpdateNotes.length === 0) return ['No model update notes were generated.'];
  return report.modelUpdateNotes.map((note) =>
    note
      .replace('No model update recommended yet; run `evaluate` after matches finalize, then rerun calibration.', 'No model update is recommended yet. Evaluate finalized matches, then rerun calibration.')
      .replace('Sample size is below 5 finalized predictions; treat calibration as diagnostic, not enough for automatic model retuning.', 'Sample size is still small, so treat this as diagnostic rather than automatic model retuning.'),
  );
}

function friendlyCalibrationWarnings(report: PostMatchCalibrationReport): string[] {
  const warnings = report.warnings.map((warning) => {
    if (warning.includes('No finalized evaluated')) {
      return 'No finalized evaluated reports matched this scope yet.';
    }
    return warning;
  });
  if (warnings.length === 0) return ['No major calibration warnings were detected.'];
  return [...new Set(warnings)].slice(0, 5);
}

function nextHistoryAction(decisionCount: number, pendingCount: number, evaluatedCount: number): string {
  if (decisionCount === 0) return 'Generate a personal prediction preview to create your first saved DecisionReport.';
  if (pendingCount === 0 && evaluatedCount === 0) return 'Tap Sync Chain Predictions to import submitted wallet bets from live SmartCup chain state, then use history as an audit log until results finalize.';
  if (pendingCount > 0) return 'After matches finalize, run evaluation so history and calibration can learn from results.';
  if (evaluatedCount === 0) return 'No evaluated results yet. Keep using history as an audit log until match results finalize.';
  return 'Open Calibration to see whether the model is well calibrated against finalized results.';
}

function nextCalibrationAction(report: PostMatchCalibrationReport): string {
  if (report.sampleSize === 0) return 'Wait for finalized matches, run evaluation, then rerun calibration.';
  if (report.sampleSize < 5) return 'Keep collecting evaluated results before changing model weights.';
  if (report.averageBrierScore > 0.24 || report.averageLogLoss > 1.2) {
    return 'Review team ratings, source quality, and crowd/opponent weighting before increasing confidence.';
  }
  return 'Calibration is usable for an early sample. Keep collecting results before making large model changes.';
}

function sourceLabel(value: StoredPrediction['source']): string {
  if (value === 'agent_recommendation') return 'agent recommendation';
  if (value === 'agent_execution') return 'agent execution';
  if (value === 'imported_chain') return 'imported chain';
  return 'manual';
}

function outcomeLabel(value: string): string {
  if (value === 'home') return 'home win';
  if (value === 'away') return 'away win';
  return 'draw';
}

function scoreText(score: { home: number; away: number }): string {
  return `${score.home}-${score.away}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'not available' : value.toFixed(2);
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
