import type {
  ConfidenceDegradationReport,
  ConfidenceSourceFactor,
  SourceQualityLabel,
  SourceQualityReport,
} from '../types/index.js';

export type SourceQualityInput = {
  matchId: string;
  confidenceDegradation: ConfidenceDegradationReport;
  nowMs?: number;
};

export class SourceQualityModel {
  buildReport(input: SourceQualityInput): SourceQualityReport {
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
    const score = round(input.confidenceDegradation.coverageScore * 100);
    const label = labelFor(score);
    const degradedReadWarnings = buildDegradedReadWarnings(input.confidenceDegradation.sourceFactors);
    const retry = buildRetry(input.confidenceDegradation, label);

    return {
      matchId: input.matchId,
      generatedAt: new Date(nowMs).toISOString(),
      model: 'source_quality_v1',
      score,
      label,
      coverageScore: input.confidenceDegradation.coverageScore,
      degradedReadWarnings,
      suggestedRetryAt: retry.suggestedRetryAt,
      retryReason: retry.retryReason,
      factors: input.confidenceDegradation.sourceFactors,
      summary: summarize(score, label, degradedReadWarnings, retry.suggestedRetryAt),
      assumptions: [
        'Source quality scores data coverage, not team strength or forecast probability.',
        'The score is derived from chain, indexer, SmartCup API, odds, football context, crowd, leaderboard, and simulation factors.',
        'Suggested retry timing is advisory and does not override cutoff, duplicate, balance, exposure, or approval guards.',
        'Reports may remain actionable with degraded source quality, but approval should consider the listed degraded reads.',
      ],
    };
  }
}

function buildDegradedReadWarnings(factors: ConfidenceSourceFactor[]): string[] {
  return factors
    .filter((factor) => factor.status !== 'healthy')
    .map((factor) => `${factor.label} ${factor.status}: ${factor.detail}`);
}

function buildRetry(
  confidence: ConfidenceDegradationReport,
  label: SourceQualityLabel,
): { suggestedRetryAt: string | null; retryReason: string | null } {
  if (label === 'healthy') {
    return {
      suggestedRetryAt: null,
      retryReason: null,
    };
  }
  const suggestedRetryAt = confidence.suggestedRetryAt;
  if (!suggestedRetryAt) {
    return {
      suggestedRetryAt: null,
      retryReason: 'No retry time is suggested because the match is likely inside cutoff or the degradation is not timing-sensitive.',
    };
  }
  return {
    suggestedRetryAt,
    retryReason:
      label === 'critical'
        ? 'Critical source quality: retry before approval if cutoff allows.'
        : label === 'degraded'
          ? 'Degraded source quality: retry before approval or add missing provider context if cutoff allows.'
          : 'Usable but imperfect source quality: a later refresh may improve confidence.',
  };
}

function summarize(
  score: number,
  label: SourceQualityLabel,
  warnings: string[],
  suggestedRetryAt: string | null,
): string {
  const retry = suggestedRetryAt ? ` Suggested retry: ${suggestedRetryAt}.` : '';
  if (warnings.length === 0) return `Source quality ${label} (${score}/100).${retry}`;
  return `Source quality ${label} (${score}/100) with ${warnings.length} degraded read(s).${retry}`;
}

function labelFor(score: number): SourceQualityLabel {
  if (score >= 85) return 'healthy';
  if (score >= 65) return 'usable';
  if (score >= 40) return 'degraded';
  return 'critical';
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
