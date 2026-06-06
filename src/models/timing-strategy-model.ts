import type {
  MarketOddsComparisonReport,
  TimingStrategyRecommendation,
  TimingStrategyReport,
  TimingStrategySignal,
  TournamentCutoffPolicy,
} from '../types/index.js';

export type TimingStrategyInput = {
  matchId: string;
  kickOffMs: number;
  phaseWeight: number;
  cutoff: TournamentCutoffPolicy;
  sourceWarnings: string[];
  marketComparison: MarketOddsComparisonReport;
  selectedConfidence: number;
  nowMs?: number;
};

export class TimingStrategyModel {
  buildReport(input: TimingStrategyInput): TimingStrategyReport {
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
    const predictionCutoffMs = input.kickOffMs - input.cutoff.predictionCutoffMinutes * 60_000;
    const agentSafetyCloseMs = predictionCutoffMs - input.cutoff.safetyBufferMs;
    const minutesUntilKickoff = minutesBetween(nowMs, input.kickOffMs);
    const minutesUntilPredictionCutoff = minutesBetween(nowMs, predictionCutoffMs);
    const minutesUntilAgentSafetyClose = minutesBetween(nowMs, agentSafetyCloseMs);
    const sourceQuality = classifySourceQuality(input.sourceWarnings);
    const dataVolatility = classifyDataVolatility(minutesUntilKickoff);
    const signals = buildSignals({
      minutesUntilKickoff,
      minutesUntilAgentSafetyClose,
      sourceQuality,
      dataVolatility,
      marketComparison: input.marketComparison,
      phaseWeight: input.phaseWeight,
      selectedConfidence: input.selectedConfidence,
    });
    const recommendation = chooseRecommendation(signals, minutesUntilAgentSafetyClose);
    const warnings = buildWarnings(input, minutesUntilAgentSafetyClose, sourceQuality);
    const nextReviewAt = buildNextReviewAt(nowMs, agentSafetyCloseMs, recommendation, dataVolatility);

    return {
      matchId: input.matchId,
      generatedAt: new Date(nowMs).toISOString(),
      model: 'timing_strategy_v1',
      recommendation,
      confidence: classifyTimingConfidence(signals, recommendation),
      currentTime: new Date(nowMs).toISOString(),
      kickoffAt: new Date(input.kickOffMs).toISOString(),
      predictionCutoffAt: new Date(predictionCutoffMs).toISOString(),
      agentSafetyCloseAt: new Date(agentSafetyCloseMs).toISOString(),
      minutesUntilKickoff,
      minutesUntilPredictionCutoff,
      minutesUntilAgentSafetyClose,
      dataVolatility,
      sourceQuality,
      rationale: buildRationale(recommendation, signals, nextReviewAt),
      signals,
      nextReviewAt,
      warnings,
    };
  }
}

function buildSignals(input: {
  minutesUntilKickoff: number;
  minutesUntilAgentSafetyClose: number;
  sourceQuality: TimingStrategyReport['sourceQuality'];
  dataVolatility: TimingStrategyReport['dataVolatility'];
  marketComparison: MarketOddsComparisonReport;
  phaseWeight: number;
  selectedConfidence: number;
}): TimingStrategySignal[] {
  return [
    cutoffSignal(input.minutesUntilAgentSafetyClose),
    kickoffDistanceSignal(input.minutesUntilKickoff, input.dataVolatility),
    sourceQualitySignal(input.sourceQuality),
    marketAvailabilitySignal(input.marketComparison),
    phaseWeightSignal(input.phaseWeight),
    confidenceSignal(input.selectedConfidence),
    crowdInformationSignal(input.minutesUntilKickoff),
  ];
}

function cutoffSignal(minutesUntilAgentSafetyClose: number): TimingStrategySignal {
  if (minutesUntilAgentSafetyClose <= 0) {
    return {
      key: 'cutoff_window',
      label: 'Cutoff window',
      direction: 'blocked',
      severity: 'high',
      detail: 'The match is inside the SmartCup cutoff plus agent safety buffer.',
    };
  }
  if (minutesUntilAgentSafetyClose <= 120) {
    return {
      key: 'cutoff_window',
      label: 'Cutoff window',
      direction: 'predict_now',
      severity: 'high',
      detail: `Only ${round(minutesUntilAgentSafetyClose)} minute(s) remain before the agent safety close.`,
    };
  }
  if (minutesUntilAgentSafetyClose <= 720) {
    return {
      key: 'cutoff_window',
      label: 'Cutoff window',
      direction: 'predict_now',
      severity: 'medium',
      detail: `${round(minutesUntilAgentSafetyClose)} minute(s) remain before the agent safety close.`,
    };
  }
  return {
    key: 'cutoff_window',
    label: 'Cutoff window',
    direction: 'neutral',
    severity: 'low',
    detail: `${round(minutesUntilAgentSafetyClose)} minute(s) remain before the agent safety close.`,
  };
}

function kickoffDistanceSignal(
  minutesUntilKickoff: number,
  dataVolatility: TimingStrategyReport['dataVolatility'],
): TimingStrategySignal {
  if (minutesUntilKickoff > 1440) {
    return {
      key: 'kickoff_distance',
      label: 'Kickoff distance',
      direction: 'wait',
      severity: dataVolatility === 'high' ? 'high' : 'medium',
      detail: `Kickoff is ${round(minutesUntilKickoff / 60)} hour(s) away; lineup/news/crowd information can still move.`,
    };
  }
  if (minutesUntilKickoff > 360) {
    return {
      key: 'kickoff_distance',
      label: 'Kickoff distance',
      direction: 'wait',
      severity: 'medium',
      detail: `Kickoff is ${round(minutesUntilKickoff / 60)} hour(s) away; one more refresh may improve information quality.`,
    };
  }
  return {
    key: 'kickoff_distance',
    label: 'Kickoff distance',
    direction: 'predict_now',
    severity: 'medium',
    detail: `Kickoff is ${round(minutesUntilKickoff / 60)} hour(s) away; late information gains are smaller than cutoff risk.`,
  };
}

function sourceQualitySignal(sourceQuality: TimingStrategyReport['sourceQuality']): TimingStrategySignal {
  if (sourceQuality === 'degraded') {
    return {
      key: 'source_quality',
      label: 'Source quality',
      direction: 'wait',
      severity: 'high',
      detail: 'One or more important reads are degraded; retrying later may improve the decision.',
    };
  }
  if (sourceQuality === 'partial') {
    return {
      key: 'source_quality',
      label: 'Source quality',
      direction: 'wait',
      severity: 'medium',
      detail: 'Some optional reads are missing or partial; refresh before committing if there is enough time.',
    };
  }
  return {
    key: 'source_quality',
    label: 'Source quality',
    direction: 'predict_now',
    severity: 'low',
    detail: 'Current source coverage is healthy enough for a decision preview.',
  };
}

function marketAvailabilitySignal(market: MarketOddsComparisonReport): TimingStrategySignal {
  if (!market.providerConfigured || market.selected.outcomeComparison === null) {
    return {
      key: 'market_availability',
      label: 'Market availability',
      direction: 'wait',
      severity: 'low',
      detail: 'Market odds are unavailable; waiting may help if an odds snapshot can be added before cutoff.',
    };
  }
  return {
    key: 'market_availability',
    label: 'Market availability',
    direction: 'predict_now',
    severity: 'low',
    detail: 'Market odds are available for comparison against the selected outcome.',
  };
}

function phaseWeightSignal(phaseWeight: number): TimingStrategySignal {
  if (phaseWeight >= 4) {
    return {
      key: 'phase_weight',
      label: 'Phase weight',
      direction: 'wait',
      severity: 'medium',
      detail: `Phase weight is x${phaseWeight}; high-leverage matches deserve a fresher final review when time allows.`,
    };
  }
  return {
    key: 'phase_weight',
    label: 'Phase weight',
    direction: 'neutral',
    severity: 'low',
    detail: `Phase weight is x${phaseWeight}; timing pressure is normal for this phase.`,
  };
}

function confidenceSignal(selectedConfidence: number): TimingStrategySignal {
  if (selectedConfidence >= 0.7) {
    return {
      key: 'confidence',
      label: 'Prediction confidence',
      direction: 'predict_now',
      severity: 'medium',
      detail: `Selected decision confidence is ${round(selectedConfidence)}.`,
    };
  }
  if (selectedConfidence < 0.45) {
    return {
      key: 'confidence',
      label: 'Prediction confidence',
      direction: 'wait',
      severity: 'medium',
      detail: `Selected decision confidence is ${round(selectedConfidence)}; retrying closer to kickoff may improve conviction.`,
    };
  }
  return {
    key: 'confidence',
    label: 'Prediction confidence',
    direction: 'neutral',
    severity: 'low',
    detail: `Selected decision confidence is ${round(selectedConfidence)}.`,
  };
}

function crowdInformationSignal(minutesUntilKickoff: number): TimingStrategySignal {
  if (minutesUntilKickoff > 720) {
    return {
      key: 'crowd_information',
      label: 'Crowd information',
      direction: 'wait',
      severity: 'medium',
      detail: 'Visible pool/crowd signals can become more informative as more users submit predictions.',
    };
  }
  return {
    key: 'crowd_information',
    label: 'Crowd information',
    direction: 'neutral',
    severity: 'low',
    detail: 'Current crowd signal is usable; waiting mostly trades freshness against cutoff risk.',
  };
}

function chooseRecommendation(
  signals: TimingStrategySignal[],
  minutesUntilAgentSafetyClose: number,
): TimingStrategyRecommendation {
  if (minutesUntilAgentSafetyClose <= 0 || signals.some((signal) => signal.direction === 'blocked')) {
    return 'blocked_by_cutoff';
  }

  const predictScore = signalScore(signals, 'predict_now');
  const waitScore = signalScore(signals, 'wait');
  if (minutesUntilAgentSafetyClose <= 120) return 'predict_now';
  return waitScore > predictScore + 1 ? 'wait' : 'predict_now';
}

function signalScore(signals: TimingStrategySignal[], direction: 'predict_now' | 'wait'): number {
  return signals
    .filter((signal) => signal.direction === direction)
    .reduce((sum, signal) => sum + severityWeight(signal.severity), 0);
}

function severityWeight(severity: TimingStrategySignal['severity']): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function classifyDataVolatility(minutesUntilKickoff: number): TimingStrategyReport['dataVolatility'] {
  if (minutesUntilKickoff > 1440) return 'high';
  if (minutesUntilKickoff > 360) return 'medium';
  return 'low';
}

function classifySourceQuality(sourceWarnings: string[]): TimingStrategyReport['sourceQuality'] {
  if (sourceWarnings.some((warning) => /chain|querymatch|querystate|rpc|transport|timeout|indexer/i.test(warning))) {
    return 'degraded';
  }
  if (sourceWarnings.length > 0) return 'partial';
  return 'healthy';
}

function classifyTimingConfidence(
  signals: TimingStrategySignal[],
  recommendation: TimingStrategyRecommendation,
): TimingStrategyReport['confidence'] {
  if (recommendation === 'blocked_by_cutoff') return 'high';
  const predictScore = signalScore(signals, 'predict_now');
  const waitScore = signalScore(signals, 'wait');
  const margin = Math.abs(predictScore - waitScore);
  if (margin >= 3) return 'high';
  if (margin >= 1) return 'medium';
  return 'low';
}

function buildWarnings(
  input: TimingStrategyInput,
  minutesUntilAgentSafetyClose: number,
  sourceQuality: TimingStrategyReport['sourceQuality'],
): string[] {
  const warnings: string[] = [];
  if (minutesUntilAgentSafetyClose <= 0) warnings.push('Match is inside cutoff plus agent safety buffer.');
  if (sourceQuality !== 'healthy') warnings.push('Timing decision is affected by degraded or partial source reads.');
  if (!input.marketComparison.providerConfigured) warnings.push('No odds provider is configured for market-timing context.');
  return warnings;
}

function buildRationale(
  recommendation: TimingStrategyRecommendation,
  signals: TimingStrategySignal[],
  nextReviewAt: string | null,
): string[] {
  const strongest = [...signals]
    .filter((signal) => signal.direction !== 'neutral')
    .sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity))
    .slice(0, 3);
  const action =
    recommendation === 'blocked_by_cutoff'
      ? 'Do not submit; the cutoff guard should block execution.'
      : recommendation === 'wait'
        ? `Wait and refresh${nextReviewAt ? ` around ${nextReviewAt}` : ''} before saving or approving a final pick.`
        : 'Prediction timing is acceptable now; approval still must pass duplicate, cutoff, balance, exposure, and policy guards.';
  return [action, ...strongest.map((signal) => `${signal.label}: ${signal.detail}`)];
}

function buildNextReviewAt(
  nowMs: number,
  agentSafetyCloseMs: number,
  recommendation: TimingStrategyRecommendation,
  dataVolatility: TimingStrategyReport['dataVolatility'],
): string | null {
  if (recommendation !== 'wait') return null;
  const intervalMs = dataVolatility === 'high' ? 6 * 60 * 60_000 : 2 * 60 * 60_000;
  const reviewMs = Math.min(nowMs + intervalMs, agentSafetyCloseMs - 30 * 60_000);
  return reviewMs > nowMs ? new Date(reviewMs).toISOString() : null;
}

function minutesBetween(startMs: number, endMs: number): number {
  return round((endMs - startMs) / 60_000);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
