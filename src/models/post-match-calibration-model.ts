import type {
  DecisionReport,
  PoolOutcome,
  PostMatchCalibrationEntry,
  PostMatchCalibrationReport,
  Score,
  StoredOutcomeEvaluation,
} from '../types/index.js';

const EPSILON = 1e-12;

export type PostMatchCalibrationInput = {
  decisions: DecisionReport[];
  evaluations: StoredOutcomeEvaluation[];
  tournamentId?: string | null;
  matchId?: string | null;
  limit?: number | null;
};

export class PostMatchCalibrationModel {
  buildReport(input: PostMatchCalibrationInput): PostMatchCalibrationReport {
    const generatedAt = new Date().toISOString();
    const decisionsById = new Map(input.decisions.map((decision) => [decision.id, decision]));
    const warnings: string[] = [];

    const entries = input.evaluations
      .filter((evaluation) => evaluation.status === 'evaluated')
      .map((evaluation) => ({ evaluation, decision: decisionsById.get(evaluation.decisionId) ?? null }))
      .filter((entry) => {
        if (!entry.decision) {
          warnings.push(`Evaluation ${entry.evaluation.id} has no matching saved DecisionReport.`);
          return false;
        }
        return true;
      })
      .filter((entry): entry is { evaluation: StoredOutcomeEvaluation; decision: DecisionReport } => Boolean(entry.decision))
      .filter(({ evaluation, decision }) => {
        if (!evaluation.actual.score || !evaluation.actual.outcome) {
          warnings.push(`Evaluation ${evaluation.id} is marked evaluated but has no finalized score/outcome.`);
          return false;
        }
        if (input.tournamentId && decision.tournament.id !== input.tournamentId) return false;
        if (input.matchId && evaluation.matchId !== input.matchId) return false;
        return true;
      })
      .sort((a, b) => b.evaluation.evaluatedAt.localeCompare(a.evaluation.evaluatedAt))
      .slice(0, input.limit ?? undefined)
      .map(({ evaluation, decision }) => buildCalibrationEntry(evaluation, decision));

    if (entries.length === 0) {
      warnings.push('No finalized evaluated DecisionReports matched the calibration filters.');
    }

    const exactHits = entries.filter((entry) => entry.exactHit).length;
    const outcomeHits = entries.filter((entry) => entry.outcomeHit).length;
    const awardedPoints = presentNumbers(entries.map((entry) => entry.awardedWeightedPoints));
    const expectedPoints = presentNumbers(entries.map((entry) => entry.expectedWeightedPoints));
    const sourceQualityScores = presentNumbers(entries.map((entry) => entry.sourceQualityScore));
    const averageAwardedWeightedPoints = nullableAverage(awardedPoints);
    const averageExpectedWeightedPoints = nullableAverage(expectedPoints);

    return {
      id: `post-match-calibration-${generatedAt.replace(/[:.]/g, '-')}`,
      generatedAt,
      schemaVersion: 'smartpredictor.post_match_calibration_report.v1',
      model: 'post_match_calibration_v1',
      filters: {
        tournamentId: input.tournamentId ?? null,
        matchId: input.matchId ?? null,
        limit: input.limit ?? null,
      },
      sampleSize: entries.length,
      exactHits,
      outcomeHits,
      exactHitRate: rate(exactHits, entries.length),
      outcomeHitRate: rate(outcomeHits, entries.length),
      averagePredictedExactProbability: average(entries.map((entry) => entry.predictedExactProbability)),
      averagePredictedProbabilityForActualOutcome: average(
        entries.map((entry) => entry.predictedProbabilityForActualOutcome),
      ),
      averageBrierScore: average(entries.map((entry) => entry.brierScore)),
      averageLogLoss: average(entries.map((entry) => entry.logLoss)),
      averageConfidence: average(entries.map((entry) => entry.confidence)),
      averageSourceQualityScore: nullableAverage(sourceQualityScores),
      averageAwardedWeightedPoints,
      averageExpectedWeightedPoints,
      pointsDelta:
        averageAwardedWeightedPoints === null || averageExpectedWeightedPoints === null
          ? null
          : round(averageAwardedWeightedPoints - averageExpectedWeightedPoints),
      entries,
      modelUpdateNotes: buildModelUpdateNotes(entries, sourceQualityScores),
      assumptions: [
        'Brier score is normalized across home/draw/away outcomes, so lower is better and 0 is perfect.',
        'Log loss uses the predicted probability assigned to the actual home/draw/away outcome.',
        'Exact-score calibration compares the selected exact-score probability against exact-score hit/miss outcomes.',
        'If the actual exact score was not the selected score, the historical DecisionReport may not contain the full actual-score matrix probability.',
      ],
      warnings,
    };
  }
}

export function renderPostMatchCalibrationSummary(report: PostMatchCalibrationReport): string {
  const lines = [
    'Post-match calibration report',
    `Generated: ${report.generatedAt}`,
    `Filters: tournament=${report.filters.tournamentId ?? 'all'}, match=${report.filters.matchId ?? 'all'}, limit=${report.filters.limit ?? 'none'}`,
    `Evaluated sample: ${report.sampleSize}`,
    `Exact hits: ${report.exactHits}/${report.sampleSize} (${report.exactHitRate})`,
    `Outcome hits: ${report.outcomeHits}/${report.sampleSize} (${report.outcomeHitRate})`,
    `Average selected exact probability: ${report.averagePredictedExactProbability}`,
    `Average probability assigned to actual outcome: ${report.averagePredictedProbabilityForActualOutcome}`,
    `Average Brier score: ${report.averageBrierScore}`,
    `Average log loss: ${report.averageLogLoss}`,
    `Average confidence: ${report.averageConfidence}`,
    `Average source quality: ${report.averageSourceQualityScore ?? 'n/a'}`,
    `Average awarded weighted points: ${report.averageAwardedWeightedPoints ?? 'n/a'}`,
    `Average expected weighted points: ${report.averageExpectedWeightedPoints ?? 'n/a'}`,
    `Average points delta: ${report.pointsDelta ?? 'n/a'}`,
  ];

  if (report.entries.length > 0) {
    lines.push('', 'Calibrated decisions:');
    for (const [index, entry] of report.entries.slice(0, 12).entries()) {
      lines.push(
        `${index + 1}. ${entry.decisionId} | match ${entry.matchId} | predicted ${scoreText(entry.predictedScore)} ${entry.predictedOutcome}, actual ${scoreText(entry.actualScore)} ${entry.actualOutcome} | exact=${entry.exactHit ? 'yes' : 'no'} outcome=${entry.outcomeHit ? 'yes' : 'no'} | p(actual outcome)=${entry.predictedProbabilityForActualOutcome} | brier=${entry.brierScore} logLoss=${entry.logLoss}`,
      );
    }
  }

  if (report.modelUpdateNotes.length > 0) {
    lines.push('', 'Model update notes:');
    for (const note of report.modelUpdateNotes) lines.push(`- ${note}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return lines.join('\n');
}

function buildCalibrationEntry(
  evaluation: StoredOutcomeEvaluation,
  decision: DecisionReport,
): PostMatchCalibrationEntry {
  const actualScore = evaluation.actual.score as Score;
  const actualOutcome = evaluation.actual.outcome as PoolOutcome;
  const selectedOutcomeProbability = probabilityForOutcome(decision, decision.selected.outcome);
  const actualOutcomeProbability = probabilityForOutcome(decision, actualOutcome);
  const exactHit = scoresEqual(decision.selected.score, actualScore) && decision.selected.penaltyWinner === evaluation.actual.penaltyWinner;
  const outcomeHit = decision.selected.outcome === actualOutcome;

  return {
    decisionId: decision.id,
    evaluationId: evaluation.id,
    matchId: evaluation.matchId,
    evaluatedAt: evaluation.evaluatedAt,
    tournamentId: decision.tournament.id,
    riskMode: decision.riskMode,
    predictedScore: decision.selected.score,
    actualScore,
    predictedOutcome: decision.selected.outcome,
    actualOutcome,
    exactHit,
    outcomeHit,
    predictedExactProbability: round(decision.probabilities.exactScore),
    predictedProbabilityForSelectedOutcome: round(selectedOutcomeProbability),
    predictedProbabilityForActualOutcome: round(actualOutcomeProbability),
    brierScore: brierScore(decision, actualOutcome),
    logLoss: round(-Math.log(Math.max(actualOutcomeProbability, EPSILON))),
    confidence: round(decision.selected.confidence),
    confidenceLabel: decision.summary.confidenceLabel,
    sourceQualityScore: decision.sections?.sourceQuality?.score ?? null,
    sourceQualityLabel: decision.sections?.sourceQuality?.label ?? null,
    awardedWeightedPoints: evaluation.points.awardedWeightedPoints,
    expectedWeightedPoints: decision.economics.expectedWeightedPoints,
    modelVersions: decision.modelVersions,
    notes: buildEntryNotes(evaluation, decision, exactHit, outcomeHit),
  };
}

function buildEntryNotes(
  evaluation: StoredOutcomeEvaluation,
  decision: DecisionReport,
  exactHit: boolean,
  outcomeHit: boolean,
): string[] {
  const notes = [...evaluation.notes];
  notes.push(
    exactHit
      ? 'Calibration: selected exact-score probability was rewarded with an exact hit.'
      : 'Calibration: selected exact-score probability resulted in an exact miss.',
  );
  notes.push(
    outcomeHit
      ? 'Calibration: home/draw/away outcome probability landed on the realized outcome.'
      : 'Calibration: realized outcome was outside the selected home/draw/away side.',
  );
  if ((decision.sections?.sourceQuality?.score ?? 100) < 50) {
    notes.push('Calibration: original report had weak source quality, so avoid aggressive model updates from this sample alone.');
  }
  return notes;
}

function buildModelUpdateNotes(entries: PostMatchCalibrationEntry[], sourceQualityScores: number[]): string[] {
  if (entries.length === 0) {
    return [
      'No model update recommended yet; run `evaluate` after matches finalize, then rerun calibration.',
      'Keep current rating and risk weights unchanged until finalized results create a non-empty sample.',
    ];
  }

  const notes: string[] = [];
  if (entries.length < 5) {
    notes.push('Sample size is below 5 finalized predictions; treat calibration as diagnostic, not enough for automatic model retuning.');
  }

  const avgBrier = average(entries.map((entry) => entry.brierScore));
  const avgLogLoss = average(entries.map((entry) => entry.logLoss));
  const exactHitRate = rate(entries.filter((entry) => entry.exactHit).length, entries.length);
  const outcomeHitRate = rate(entries.filter((entry) => entry.outcomeHit).length, entries.length);
  const avgActualOutcomeProbability = average(entries.map((entry) => entry.predictedProbabilityForActualOutcome));
  const avgSourceQuality = nullableAverage(sourceQualityScores);

  if (avgBrier > 0.24 || avgLogLoss > 1.2) {
    notes.push('Outcome calibration is weak; review team ratings, home advantage, and opponent/crowd weighting before increasing confidence.');
  } else {
    notes.push('Outcome calibration is within a usable early range; keep collecting results before changing core forecast weights.');
  }

  if (outcomeHitRate < 0.4 && entries.length >= 5) {
    notes.push('Outcome hit rate is low; prioritize football model inputs over payout/contrarian layers for upcoming reports.');
  }

  if (avgActualOutcomeProbability < 0.38 && entries.length >= 5) {
    notes.push('The model assigned low probability to realized outcomes; inspect rating seeds and provider context freshness.');
  }

  if (exactHitRate === 0 && entries.length >= 8) {
    notes.push('Exact-score hit rate is zero over a larger sample; inspect Poisson goal means and public-score priors.');
  }

  if (avgSourceQuality !== null && avgSourceQuality < 50) {
    notes.push('Average source quality is weak; improve indexer/API/news coverage before treating calibration as model failure.');
  }

  return notes;
}

function brierScore(decision: DecisionReport, actualOutcome: PoolOutcome): number {
  const probabilities = {
    home: decision.probabilities.home,
    draw: decision.probabilities.draw,
    away: decision.probabilities.away,
  };
  const sum = (['home', 'draw', 'away'] as const).reduce((total, outcome) => {
    const observed = outcome === actualOutcome ? 1 : 0;
    return total + Math.pow((probabilities[outcome] ?? 0) - observed, 2);
  }, 0);
  return round(sum / 3);
}

function probabilityForOutcome(decision: DecisionReport, outcome: PoolOutcome): number {
  return decision.probabilities[outcome] ?? 0;
}

function scoresEqual(left: Score, right: Score): boolean {
  return left.home === right.home && left.away === right.away;
}

function scoreText(score: Score): string {
  return `${score.home}-${score.away}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function nullableAverage(values: number[]): number | null {
  return values.length === 0 ? null : average(values);
}

function rate(count: number, total: number): number {
  if (total <= 0) return 0;
  return round(count / total);
}

function presentNumbers(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
