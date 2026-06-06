import type {
  AnalysisProductDefinition,
  AnalysisProductKey,
} from '../types/index.js';

export const ANALYSIS_BUNDLE_TARGET_MATCH_COUNT = 5;

export const analysisProductDefinitions: Record<AnalysisProductKey, AnalysisProductDefinition> = {
  single_match: {
    key: 'single_match',
    name: 'Single-match report',
    shortName: 'Single Match',
    description: 'One SmartCup match recommendation with score, outcome, EV, points, and risk context.',
    matchScope: 'one_match',
    targetMatchCount: 1,
    defaultObjective: 'one SmartCup match recommendation',
    defaultPriceUsd: null,
    supportedPillars: ['personal_operator'],
    requiredInputs: ['tournament_id', 'match_id', 'risk_mode'],
    reportArtifacts: ['decision_report', 'markdown_export', 'json_export'],
    personal: {
      pillar: 'personal_operator',
      canSaveDecisionReport: true,
      canAttachApproval: true,
      canExecuteWalletAction: true,
      notes: [
        'Uses the connected operator wallet context.',
        'Execution is possible only through explicit approval and policy guards.',
      ],
    },
  },
  five_match_bundle: {
    key: 'five_match_bundle',
    name: 'Open-match bundle',
    shortName: '5-Match Bundle',
    description: 'Exactly five eligible SmartCup match recommendations in one tournament.',
    matchScope: 'exactly_five_matches',
    targetMatchCount: ANALYSIS_BUNDLE_TARGET_MATCH_COUNT,
    defaultObjective: 'recommendations for the next five open matches the user has not predicted yet',
    defaultPriceUsd: null,
    supportedPillars: ['personal_operator'],
    requiredInputs: ['tournament_id', 'five_match_ids', 'risk_mode'],
    reportArtifacts: ['bundle_report', 'decision_report', 'markdown_export', 'json_export'],
    personal: {
      pillar: 'personal_operator',
      canSaveDecisionReport: true,
      canAttachApproval: true,
      canExecuteWalletAction: true,
      notes: [
        'Uses the connected operator wallet to exclude already predicted matches.',
        'Each match can produce a saved DecisionReport; each execution still needs explicit approval.',
      ],
    },
  },
  podium_strategy: {
    key: 'podium_strategy',
    name: 'Podium strategy analysis',
    shortName: 'Podium Strategy',
    description: 'Champion, runner-up, and third-place strategy with timing, confidence, and path assumptions.',
    matchScope: 'podium_pick',
    targetMatchCount: null,
    defaultObjective: 'champion, runner-up, and third-place strategy',
    defaultPriceUsd: null,
    supportedPillars: ['personal_operator'],
    requiredInputs: ['tournament_id', 'podium_pick_window', 'risk_mode'],
    reportArtifacts: ['podium_report', 'markdown_export', 'json_export'],
    personal: {
      pillar: 'personal_operator',
      canSaveDecisionReport: false,
      canAttachApproval: true,
      canExecuteWalletAction: true,
      notes: [
        'Uses tournament state and bracket assumptions for the connected operator account.',
        'Submission support depends on the guarded SubmitPodiumPick executor path.',
      ],
    },
  },
  tournament_advisory: {
    key: 'tournament_advisory',
    name: 'Tournament advisory analysis',
    shortName: 'Tournament Advisory',
    description: 'Rolling tournament plan with priority matches, leaderboard posture, risk, and next actions.',
    matchScope: 'tournament_plan',
    targetMatchCount: null,
    defaultObjective: 'rolling tournament advisory and risk posture',
    defaultPriceUsd: null,
    supportedPillars: ['personal_operator'],
    requiredInputs: ['tournament_id', 'risk_mode', 'strategy_posture'],
    reportArtifacts: ['tournament_advisory_report', 'markdown_export', 'json_export'],
    personal: {
      pillar: 'personal_operator',
      canSaveDecisionReport: true,
      canAttachApproval: false,
      canExecuteWalletAction: false,
      notes: [
        'Read-only planning layer for the connected wallet.',
        'Specific match submissions should be handled by individual saved DecisionReports.',
      ],
    },
  },
};

export function getAnalysisProductDefinition(product: AnalysisProductKey): AnalysisProductDefinition {
  return analysisProductDefinitions[product];
}

export function parseAnalysisProductKey(value: string): AnalysisProductKey {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'single' || normalized === 'single_match') return 'single_match';
  if (
    normalized === 'bundle' ||
    normalized === 'five_match_bundle' ||
    normalized === 'five_match' ||
    normalized === '5_match_bundle'
  ) {
    return 'five_match_bundle';
  }
  if (normalized === 'podium' || normalized === 'podium_strategy') return 'podium_strategy';
  if (normalized === 'tournament' || normalized === 'tournament_advisory') return 'tournament_advisory';
  throw new Error('Invalid analysis product. Use single_match|five_match_bundle|podium_strategy|tournament_advisory.');
}
