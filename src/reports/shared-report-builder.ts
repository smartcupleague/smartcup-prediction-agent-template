import { getAnalysisProductDefinition } from '../products/index.js';
import type {
  DecisionReport,
  AnalysisProductKey,
  RecommendationPillar,
} from '../types/index.js';

export type SharedReportVisibility = 'personal';
export type SharedReportFormat = 'text' | 'markdown' | 'json';

export type SharedAnalysisReportInput = {
  product: AnalysisProductKey;
  pillar: RecommendationPillar;
  visibility: SharedReportVisibility;
  decisions: DecisionReport[];
  generatedAt?: string | undefined;
};

export type SharedAnalysisDecisionItem = {
  decisionId: string;
  matchId: string;
  matchLabel: string;
  tournamentId: string;
  tournamentName: string;
  phase: string;
  phaseWeight: number;
  riskMode: string;
  confidenceLabel: DecisionReport['summary']['confidenceLabel'];
  sourceWarningCount: number;
  selected:
    | {
        score: string;
        outcome: string;
        penaltyWinner: string | null;
        confidence: number;
        exactScoreProbability: number;
        homeProbability: number;
        drawProbability: number;
        awayProbability: number;
        expectedWeightedPoints: number | null;
        expectedRoi: number | null;
        marketOutcomeEdge: number | null;
        marketOutcomeProbability: number | null;
        marketSummary: string | null;
        timingRecommendation: string | null;
        timingNextReviewAt: string | null;
        timingSummary: string | null;
        crowdMapSummary: string | null;
        topContrarianScore: string | null;
        topContrarianLevel: string | null;
        topContrarianDifferentiation: number | null;
        footballContextSummary: string | null;
        footballContextRisk: string | null;
        footballContextFreshness: string | null;
        footballContextUncertainty: string | null;
        tournamentPositionPosture: string | null;
        tournamentPositionRecommendation: string | null;
        tournamentPositionRiskMode: string | null;
        tournamentPositionObjective: string | null;
        alternativePicksSummary: string | null;
        safestPick: string | null;
        balancedPick: string | null;
        contrarianPick: string | null;
        leaderboardUpsidePick: string | null;
        confidenceQualitySummary: string | null;
        confidenceDegradationLevel: string | null;
        originalConfidence: number | null;
        adjustedConfidence: number | null;
        sourceQualityScore: number | null;
        sourceQualityLabel: string | null;
        sourceQualitySummary: string | null;
        sourceQualitySuggestedRetryAt: string | null;
      }
    | null;
  publicSummary: string;
  privateRationale: string[];
};

export type SharedAnalysisReport = {
  schemaVersion: 'smartpredictor.shared_analysis_report.v1';
  generatedAt: string;
  product: {
    key: AnalysisProductKey;
    name: string;
    matchScope: string;
    targetMatchCount: number | null;
  };
  pillar: RecommendationPillar;
  visibility: SharedReportVisibility;
  matchIds: string[];
  decisionIds: string[];
  tournamentIds: string[];
  sourceWarningCount: number;
  decisions: SharedAnalysisDecisionItem[];
  disclosures: {
    safety: string;
    privacy: string;
  };
};

export type SharedAnalysisReportRender = {
  report: SharedAnalysisReport;
  personalText: string;
  personalPrivateText: string;
  publicSummaryText: string;
  markdown: string;
  json: string;
};

export function buildSharedAnalysisReport(input: SharedAnalysisReportInput): SharedAnalysisReport {
  const definition = getAnalysisProductDefinition(input.product);
  const decisions = input.decisions.map((decision) => buildDecisionItem(decision, false));

  return {
    schemaVersion: 'smartpredictor.shared_analysis_report.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    product: {
      key: definition.key,
      name: definition.name,
      matchScope: definition.matchScope,
      targetMatchCount: definition.targetMatchCount,
    },
    pillar: input.pillar,
    visibility: input.visibility,
    matchIds: unique(decisions.map((decision) => decision.matchId)),
    decisionIds: unique(decisions.map((decision) => decision.decisionId)),
    tournamentIds: unique(decisions.map((decision) => decision.tournamentId)),
    sourceWarningCount: decisions.reduce((sum, decision) => sum + decision.sourceWarningCount, 0),
    decisions,
    disclosures: {
      safety:
        'Safety: this is a personal, non-custodial SmartCup agent. It never needs your mnemonic, private key, seed phrase, browser session, or wallet JSON. You keep custody, verify recommendations, and approve wallet actions explicitly.',
      privacy: 'Full recommendation details are visible only in the local personal agent workspace or exported personal report.',
    },
  };
}

export function buildSharedAnalysisReportRender(input: SharedAnalysisReportInput): SharedAnalysisReportRender {
  const report = buildSharedAnalysisReport(input);
  return {
    report,
    personalText: renderSharedAnalysisReportText(report, 'personal'),
    personalPrivateText: renderSharedAnalysisReportText(report, 'personal'),
    publicSummaryText: renderSharedAnalysisReportText(report, 'personal'),
    markdown: renderSharedAnalysisReportMarkdown(report),
    json: JSON.stringify(report, null, 2),
  };
}

export function renderSharedAnalysisReportText(
  report: SharedAnalysisReport,
  visibility: SharedReportVisibility = report.visibility,
): string {
  const title =
    'SmartPredictor personal analysis';
  const decisionLines = report.decisions.length
    ? report.decisions.flatMap((decision) => renderDecisionItemText(decision, visibility))
    : ['No saved DecisionReport payload is attached to this report yet.'];

  return [
    title,
    `Product: ${report.product.name}`,
    `Product key: ${report.product.key}`,
    `Pillar: ${report.pillar}`,
    `Visibility: ${visibility}`,
    `Matches: ${report.matchIds.join(', ') || 'n/a'}`,
    `Source warnings: ${report.sourceWarningCount}`,
    '',
    ...decisionLines,
    '',
    report.disclosures.privacy,
    report.disclosures.safety,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function renderSharedAnalysisReportMarkdown(report: SharedAnalysisReport): string {
  return [
    `# ${report.product.name}`,
    '',
    `- Product key: \`${report.product.key}\``,
    `- Pillar: \`${report.pillar}\``,
    `- Visibility: \`${report.visibility}\``,
    `- Generated: \`${report.generatedAt}\``,
    `- Matches: ${report.matchIds.map((matchId) => `\`${matchId}\``).join(', ') || 'n/a'}`,
    `- Source warnings: ${report.sourceWarningCount}`,
    '',
    '## Recommendations',
    '',
    ...report.decisions.flatMap(renderDecisionItemMarkdown),
    '',
    '## Disclosure',
    '',
    report.disclosures.privacy,
    '',
    report.disclosures.safety,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildDecisionItem(decision: DecisionReport, redacted: boolean): SharedAnalysisDecisionItem {
  return {
    decisionId: decision.id,
    matchId: decision.matchId,
    matchLabel: `${decision.match.home} vs ${decision.match.away}`,
    tournamentId: decision.tournament.id,
    tournamentName: decision.tournament.name,
    phase: decision.tournament.phase,
    phaseWeight: decision.tournament.phaseWeight,
    riskMode: decision.riskMode,
    confidenceLabel: decision.summary.confidenceLabel,
    sourceWarningCount: decision.sourceWarnings.length,
    selected: redacted
      ? null
      : {
          score: `${decision.selected.score.home}-${decision.selected.score.away}`,
          outcome: decision.selected.outcome,
          penaltyWinner: decision.selected.penaltyWinner,
          confidence: decision.selected.confidence,
          exactScoreProbability: decision.probabilities.exactScore,
          homeProbability: decision.probabilities.home,
          drawProbability: decision.probabilities.draw,
          awayProbability: decision.probabilities.away,
          expectedWeightedPoints: decision.economics.expectedWeightedPoints,
          expectedRoi: decision.economics.expectedRoi,
          marketOutcomeEdge: decision.sections?.marketComparison?.selected.outcomeComparison?.edge ?? null,
          marketOutcomeProbability:
            decision.sections?.marketComparison?.selected.outcomeComparison?.marketNormalizedProbability ?? null,
          marketSummary: decision.sections?.marketComparison?.summary ?? null,
          timingRecommendation: decision.sections?.timingStrategy?.recommendation ?? null,
          timingNextReviewAt: decision.sections?.timingStrategy?.nextReviewAt ?? null,
          timingSummary: decision.sections?.timingStrategy?.rationale[0] ?? null,
          crowdMapSummary: decision.sections?.crowdContrarianMap?.summary ?? null,
          topContrarianScore: decision.sections?.crowdContrarianMap?.differentiatedOpportunities[0]
            ? `${decision.sections.crowdContrarianMap.differentiatedOpportunities[0].score.home}-${decision.sections.crowdContrarianMap.differentiatedOpportunities[0].score.away}`
            : null,
          topContrarianLevel:
            decision.sections?.crowdContrarianMap?.differentiatedOpportunities[0]?.opportunityLevel ?? null,
          topContrarianDifferentiation:
            decision.sections?.crowdContrarianMap?.differentiatedOpportunities[0]?.differentiationScore ?? null,
          footballContextSummary: decision.sections?.footballContextRisk?.summary ?? null,
          footballContextRisk: decision.sections?.footballContextRisk?.overallRisk ?? null,
          footballContextFreshness: decision.sections?.footballContextRisk?.freshness ?? null,
          footballContextUncertainty: decision.sections?.footballContextRisk?.uncertainty ?? null,
          tournamentPositionPosture: decision.sections?.tournamentPositionStrategy?.selectedPosture ?? null,
          tournamentPositionRecommendation: decision.sections?.tournamentPositionStrategy?.recommendation ?? null,
          tournamentPositionRiskMode: decision.sections?.tournamentPositionStrategy?.recommendedRiskMode ?? null,
          tournamentPositionObjective: decision.sections?.tournamentPositionStrategy?.recommendedObjective ?? null,
          alternativePicksSummary: decision.sections?.alternativePickSet?.summary ?? null,
          safestPick: formatAlternativePick(decision, 'safest'),
          balancedPick: formatAlternativePick(decision, 'balanced'),
          contrarianPick: formatAlternativePick(decision, 'contrarian'),
          leaderboardUpsidePick: formatAlternativePick(decision, 'leaderboard_upside'),
          confidenceQualitySummary: decision.sections?.confidenceDegradation?.summary ?? null,
          confidenceDegradationLevel: decision.sections?.confidenceDegradation?.degradationLevel ?? null,
          originalConfidence: decision.sections?.confidenceDegradation?.originalConfidence ?? null,
          adjustedConfidence: decision.sections?.confidenceDegradation?.adjustedConfidence ?? null,
          sourceQualityScore: decision.sections?.sourceQuality?.score ?? null,
          sourceQualityLabel: decision.sections?.sourceQuality?.label ?? null,
          sourceQualitySummary: decision.sections?.sourceQuality?.summary ?? null,
          sourceQualitySuggestedRetryAt: decision.sections?.sourceQuality?.suggestedRetryAt ?? null,
        },
    publicSummary: decision.summary.headline,
    privateRationale: redacted ? [] : [decision.summary.recommendation, ...decision.summary.bullets, ...decision.rationale],
  };
}

function renderDecisionItemText(
  decision: SharedAnalysisDecisionItem,
  visibility: SharedReportVisibility,
): string[] {
  const selected = decision.selected;
  if (!selected) {
    return [
      `Match ${decision.matchId}: ${decision.matchLabel}`,
      `Tournament: ${decision.tournamentName}`,
      `Phase: ${decision.phase} x${decision.phaseWeight}`,
      `Confidence: ${decision.confidenceLabel}`,
      `Summary: ${decision.publicSummary}`,
      'Private recommendation details are redacted.',
    ];
  }

  return [
    `Match ${decision.matchId}: ${decision.matchLabel}`,
    `Tournament: ${decision.tournamentName}`,
    `Phase: ${decision.phase} x${decision.phaseWeight}`,
    `Recommendation: ${selected.score} ${selected.outcome}`,
    selected.penaltyWinner ? `Penalty winner: ${selected.penaltyWinner}` : null,
    `Confidence: ${decision.confidenceLabel} (${selected.confidence})`,
    selected.confidenceQualitySummary
      ? `Confidence quality: ${selected.confidenceQualitySummary}`
      : null,
    selected.sourceQualitySummary
      ? `Source quality: ${selected.sourceQualitySummary}`
      : null,
    `Risk mode: ${decision.riskMode}`,
    `Exact score probability: ${selected.exactScoreProbability}`,
    `Outcome probabilities: home ${selected.homeProbability}, draw ${selected.drawProbability}, away ${selected.awayProbability}`,
    `Expected weighted points: ${selected.expectedWeightedPoints ?? 'n/a'}`,
    `Expected ROI: ${selected.expectedRoi ?? 'n/a'}`,
    selected.marketOutcomeProbability !== null
      ? `Market probability: ${selected.marketOutcomeProbability}; agent edge: ${selected.marketOutcomeEdge ?? 'n/a'}`
      : selected.marketSummary
        ? `Market comparison: ${selected.marketSummary}`
        : null,
    selected.timingRecommendation
      ? `Timing strategy: ${selected.timingRecommendation}${selected.timingNextReviewAt ? `; next review ${selected.timingNextReviewAt}` : ''}`
      : selected.timingSummary
        ? `Timing strategy: ${selected.timingSummary}`
        : null,
    selected.topContrarianScore
      ? `Crowd map: top differentiated score ${selected.topContrarianScore} (${selected.topContrarianLevel}, score ${selected.topContrarianDifferentiation})`
      : selected.crowdMapSummary
        ? `Crowd map: ${selected.crowdMapSummary}`
        : null,
    selected.footballContextSummary
      ? `Football context: risk ${selected.footballContextRisk}, freshness ${selected.footballContextFreshness}, uncertainty ${selected.footballContextUncertainty}. ${selected.footballContextSummary}`
      : null,
    selected.tournamentPositionRecommendation
      ? `Tournament position: ${selected.tournamentPositionPosture}; risk ${selected.tournamentPositionRiskMode}, objective ${selected.tournamentPositionObjective}. ${selected.tournamentPositionRecommendation}`
      : null,
    selected.alternativePicksSummary
      ? `Alternative picks: ${selected.alternativePicksSummary}`
      : null,
    `Summary: ${decision.publicSummary}`,
    ...decision.privateRationale.map((line) => `- ${line}`),
  ].filter((line): line is string => line !== null);
}

function renderDecisionItemMarkdown(decision: SharedAnalysisDecisionItem): string[] {
  const selected = decision.selected;
  return [
    `### Match ${decision.matchId}: ${decision.matchLabel}`,
    '',
    `- Tournament: ${decision.tournamentName}`,
    `- Phase: ${decision.phase} x${decision.phaseWeight}`,
    `- Confidence: ${decision.confidenceLabel}`,
    selected ? `- Recommendation: ${selected.score} ${selected.outcome}` : '- Recommendation: redacted',
    selected?.penaltyWinner ? `- Penalty winner: ${selected.penaltyWinner}` : null,
    selected ? `- Exact score probability: ${selected.exactScoreProbability}` : null,
    selected?.confidenceQualitySummary ? `- Confidence quality: ${selected.confidenceQualitySummary}` : null,
    selected?.sourceQualitySummary ? `- Source quality: ${selected.sourceQualitySummary}` : null,
    selected
      ? `- Outcome probabilities: home ${selected.homeProbability}, draw ${selected.drawProbability}, away ${selected.awayProbability}`
      : null,
    selected ? `- Expected weighted points: ${selected.expectedWeightedPoints ?? 'n/a'}` : null,
    selected?.marketOutcomeProbability !== null && selected?.marketOutcomeProbability !== undefined
      ? `- Market probability: ${selected.marketOutcomeProbability}; agent edge: ${selected.marketOutcomeEdge ?? 'n/a'}`
      : selected?.marketSummary
        ? `- Market comparison: ${selected.marketSummary}`
        : null,
    selected?.timingRecommendation
      ? `- Timing strategy: ${selected.timingRecommendation}${selected.timingNextReviewAt ? `; next review ${selected.timingNextReviewAt}` : ''}`
      : selected?.timingSummary
        ? `- Timing strategy: ${selected.timingSummary}`
        : null,
    selected?.topContrarianScore
      ? `- Crowd map: top differentiated score ${selected.topContrarianScore} (${selected.topContrarianLevel}, score ${selected.topContrarianDifferentiation})`
      : selected?.crowdMapSummary
        ? `- Crowd map: ${selected.crowdMapSummary}`
        : null,
    selected?.footballContextSummary
      ? `- Football context: risk ${selected.footballContextRisk}, freshness ${selected.footballContextFreshness}, uncertainty ${selected.footballContextUncertainty}. ${selected.footballContextSummary}`
      : null,
    selected?.tournamentPositionRecommendation
      ? `- Tournament position: ${selected.tournamentPositionPosture}; risk ${selected.tournamentPositionRiskMode}, objective ${selected.tournamentPositionObjective}. ${selected.tournamentPositionRecommendation}`
      : null,
    selected?.alternativePicksSummary ? `- Alternative picks: ${selected.alternativePicksSummary}` : null,
    '',
    decision.publicSummary,
    '',
    ...decision.privateRationale.map((line) => `- ${line}`),
    '',
  ].filter((line): line is string => line !== null);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatAlternativePick(
  decision: DecisionReport,
  kind: 'safest' | 'balanced' | 'contrarian' | 'leaderboard_upside',
): string | null {
  const pick = decision.sections?.alternativePickSet?.picks.find((entry) => entry.kind === kind);
  return pick ? `${pick.score.home}-${pick.score.away} ${pick.outcome}` : null;
}
