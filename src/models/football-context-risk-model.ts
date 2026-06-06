import type {
  FootballContextProviderBatch,
  FootballContextRiskReport,
  FootballContextRiskSignal,
  NormalizedLineupSnapshot,
  NormalizedNewsItem,
  NormalizedPlayerAvailability,
  ProviderFreshnessLabel,
  ProviderUncertaintyLabel,
  SmartCupMatch,
} from '../types/index.js';

export type FootballContextRiskInput = {
  match: SmartCupMatch;
  providerConfigured: boolean;
  context: FootballContextProviderBatch;
  nowMs?: number;
};

export class FootballContextRiskModel {
  buildReport(input: FootballContextRiskInput): FootballContextRiskReport {
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
    const homeLineup = latestLineup(input.context.lineups, input.match.home);
    const awayLineup = latestLineup(input.context.lineups, input.match.away);
    const suspensions = input.context.availability.filter((entry) => entry.status === 'suspended');
    const signals = buildSignals({
      match: input.match,
      providerConfigured: input.providerConfigured,
      context: input.context,
      homeLineup,
      awayLineup,
      suspensions,
      nowMs,
    });
    const freshness = aggregateFreshness(signals);
    const uncertainty = aggregateUncertainty(signals);
    const overallRisk = aggregateRisk(signals);
    const warnings = buildWarnings(input.providerConfigured, input.context, freshness, uncertainty);

    return {
      matchId: input.match.matchId,
      generatedAt: new Date(nowMs).toISOString(),
      model: 'football_context_risk_v1',
      provider: input.context.provider,
      providerConfigured: input.providerConfigured,
      overallRisk,
      freshness,
      uncertainty,
      lineups: {
        home: homeLineup,
        away: awayLineup,
      },
      availability: input.context.availability,
      suspensions,
      news: input.context.news,
      signals,
      summary: summarize(overallRisk, freshness, uncertainty, homeLineup, awayLineup, input.context),
      warnings,
      assumptions: [
        'Lineup, injury, suspension, and news context is advisory and does not override SmartCup chain state.',
        'Freshness is based on provider timestamps relative to the current decision time.',
        'Uncertainty combines missing lineups, projected lineups, low confidence, and unknown availability statuses.',
        'This layer labels context risk; it does not yet adjust forecast probabilities directly.',
      ],
    };
  }
}

function buildSignals(input: {
  match: SmartCupMatch;
  providerConfigured: boolean;
  context: FootballContextProviderBatch;
  homeLineup: NormalizedLineupSnapshot | null;
  awayLineup: NormalizedLineupSnapshot | null;
  suspensions: NormalizedPlayerAvailability[];
  nowMs: number;
}): FootballContextRiskSignal[] {
  return [
    providerCoverageSignal(input.providerConfigured, input.context),
    lineupFreshnessSignal(input.homeLineup, input.awayLineup, input.nowMs),
    lineupUncertaintySignal(input.homeLineup, input.awayLineup),
    availabilityRiskSignal(input.context.availability, false),
    availabilityRiskSignal(input.suspensions, true),
    newsRiskSignal(input.context.news, input.nowMs),
  ];
}

function providerCoverageSignal(
  providerConfigured: boolean,
  context: FootballContextProviderBatch,
): FootballContextRiskSignal {
  const recordCount = context.lineups.length + context.availability.length + context.news.length;
  if (!providerConfigured) {
    return {
      key: 'provider_coverage',
      label: 'Provider coverage',
      riskLevel: 'unknown',
      freshness: 'missing',
      uncertainty: 'high',
      detail: 'No football-context provider is configured.',
    };
  }
  if (recordCount === 0) {
    return {
      key: 'provider_coverage',
      label: 'Provider coverage',
      riskLevel: 'unknown',
      freshness: 'missing',
      uncertainty: 'high',
      detail: 'Provider is configured but returned no lineup, availability, or news records for this match.',
    };
  }
  return {
    key: 'provider_coverage',
    label: 'Provider coverage',
    riskLevel: 'low',
    freshness: 'usable',
    uncertainty: 'medium',
    detail: `Provider returned ${recordCount} context record(s).`,
  };
}

function lineupFreshnessSignal(
  homeLineup: NormalizedLineupSnapshot | null,
  awayLineup: NormalizedLineupSnapshot | null,
  nowMs: number,
): FootballContextRiskSignal {
  const freshness = aggregateFreshnessLabel([freshnessFromTimestamp(homeLineup?.updatedAt, nowMs), freshnessFromTimestamp(awayLineup?.updatedAt, nowMs)]);
  return {
    key: 'lineup_freshness',
    label: 'Lineup freshness',
    riskLevel: freshness === 'fresh' || freshness === 'usable' ? 'low' : freshness === 'missing' ? 'unknown' : 'medium',
    freshness,
    uncertainty: homeLineup && awayLineup ? 'medium' : 'high',
    detail:
      homeLineup && awayLineup
        ? `Lineup snapshots are ${freshness}.`
        : 'One or both lineup snapshots are missing.',
  };
}

function lineupUncertaintySignal(
  homeLineup: NormalizedLineupSnapshot | null,
  awayLineup: NormalizedLineupSnapshot | null,
): FootballContextRiskSignal {
  const statuses = [homeLineup?.status ?? 'unknown', awayLineup?.status ?? 'unknown'];
  const averageConfidence = average([homeLineup?.confidence, awayLineup?.confidence]);
  const uncertainty =
    statuses.includes('unknown') || !homeLineup || !awayLineup
      ? 'high'
      : statuses.includes('projected') || averageConfidence < 0.6
        ? 'medium'
        : 'low';
  return {
    key: 'lineup_uncertainty',
    label: 'Lineup uncertainty',
    riskLevel: uncertainty === 'high' ? 'medium' : 'low',
    freshness: 'unknown',
    uncertainty,
    detail: `Lineup statuses are ${statuses.join('/')} with average confidence ${round(averageConfidence)}.`,
  };
}

function availabilityRiskSignal(
  availability: NormalizedPlayerAvailability[],
  suspensionsOnly: boolean,
): FootballContextRiskSignal {
  const risky = availability.filter((entry) =>
    suspensionsOnly
      ? entry.status === 'suspended'
      : entry.status === 'out' || entry.status === 'doubtful' || entry.status === 'suspended',
  );
  const highSeverity = risky.filter((entry) => entry.severity === 'high').length;
  const unknown = availability.filter((entry) => entry.status === 'unknown').length;
  const riskLevel = highSeverity > 0 ? 'high' : risky.length > 0 ? 'medium' : unknown > 0 ? 'unknown' : 'low';
  return {
    key: suspensionsOnly ? 'suspension_risk' : 'availability_risk',
    label: suspensionsOnly ? 'Suspension risk' : 'Availability risk',
    riskLevel,
    freshness: aggregateFreshnessLabel(availability.map((entry) => freshnessFromTimestamp(entry.updatedAt, Date.now()))),
    uncertainty: unknown > 0 ? 'high' : risky.some((entry) => entry.confidence < 0.6) ? 'medium' : 'low',
    detail: suspensionsOnly
      ? `${risky.length} suspension record(s), ${highSeverity} high severity.`
      : `${risky.length} injury/availability risk record(s), ${highSeverity} high severity.`,
  };
}

function newsRiskSignal(news: NormalizedNewsItem[], nowMs: number): FootballContextRiskSignal {
  const negative = news.filter((entry) => entry.impactDirection === 'negative');
  const lowReliability = news.filter((entry) => (entry.sourceReliability ?? entry.confidence) < 0.55).length;
  const riskLevel = negative.length >= 2 ? 'high' : negative.length === 1 ? 'medium' : news.length > 0 ? 'low' : 'unknown';
  return {
    key: 'news_risk',
    label: 'News risk',
    riskLevel,
    freshness: aggregateFreshnessLabel(news.map((entry) => freshnessFromTimestamp(entry.publishedAt, nowMs))),
    uncertainty: lowReliability > 0 ? 'medium' : news.length === 0 ? 'unknown' : 'low',
    detail: `${news.length} news item(s), ${negative.length} negative impact, ${lowReliability} lower-reliability.`,
  };
}

function latestLineup(lineups: NormalizedLineupSnapshot[], team: string): NormalizedLineupSnapshot | null {
  return (
    lineups
      .filter((entry) => entry.team.trim().toLowerCase() === team.trim().toLowerCase())
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null
  );
}

function buildWarnings(
  providerConfigured: boolean,
  context: FootballContextProviderBatch,
  freshness: ProviderFreshnessLabel,
  uncertainty: ProviderUncertaintyLabel,
): string[] {
  const warnings = [...context.warnings];
  if (!providerConfigured) warnings.push('Football context provider is not configured.');
  if (freshness === 'missing' || freshness === 'stale') warnings.push('Football context is missing or stale.');
  if (uncertainty === 'high') warnings.push('Football context uncertainty is high.');
  return [...new Set(warnings)];
}

function summarize(
  risk: FootballContextRiskReport['overallRisk'],
  freshness: ProviderFreshnessLabel,
  uncertainty: ProviderUncertaintyLabel,
  homeLineup: NormalizedLineupSnapshot | null,
  awayLineup: NormalizedLineupSnapshot | null,
  context: FootballContextProviderBatch,
): string {
  if (!homeLineup && !awayLineup && context.availability.length === 0 && context.news.length === 0) {
    return 'Lineup, availability, suspension, and news context is unavailable for this match.';
  }
  return `Football context risk is ${risk}; freshness is ${freshness}; uncertainty is ${uncertainty}. Lineups: ${homeLineup?.status ?? 'missing'}/${awayLineup?.status ?? 'missing'}, availability records: ${context.availability.length}, news items: ${context.news.length}.`;
}

function aggregateRisk(signals: FootballContextRiskSignal[]): FootballContextRiskReport['overallRisk'] {
  if (signals.some((signal) => signal.riskLevel === 'high')) return 'high';
  if (signals.some((signal) => signal.riskLevel === 'medium')) return 'medium';
  if (signals.some((signal) => signal.riskLevel === 'unknown')) return 'unknown';
  return 'low';
}

function aggregateFreshness(signals: FootballContextRiskSignal[]): ProviderFreshnessLabel {
  return aggregateFreshnessLabel(signals.map((signal) => signal.freshness));
}

function aggregateUncertainty(signals: FootballContextRiskSignal[]): ProviderUncertaintyLabel {
  if (signals.some((signal) => signal.uncertainty === 'high')) return 'high';
  if (signals.some((signal) => signal.uncertainty === 'medium')) return 'medium';
  if (signals.some((signal) => signal.uncertainty === 'unknown')) return 'unknown';
  return 'low';
}

function aggregateFreshnessLabel(labels: ProviderFreshnessLabel[]): ProviderFreshnessLabel {
  if (labels.length === 0 || labels.every((label) => label === 'missing')) return 'missing';
  if (labels.some((label) => label === 'stale')) return 'stale';
  if (labels.some((label) => label === 'unknown')) return 'unknown';
  if (labels.some((label) => label === 'usable')) return 'usable';
  return 'fresh';
}

function freshnessFromTimestamp(value: string | null | undefined, nowMs: number): ProviderFreshnessLabel {
  if (!value) return 'missing';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'unknown';
  const ageHours = (nowMs - timestamp) / 3_600_000;
  if (ageHours <= 24) return 'fresh';
  if (ageHours <= 72) return 'usable';
  return 'stale';
}

function average(values: Array<number | null | undefined>): number {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
