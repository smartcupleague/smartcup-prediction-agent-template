import type { FundingSource, RiskMode } from '../types/index.js';
import type { TelegramCommand } from './permissions.js';

export const telegramNaturalLanguageIntents = [
  'agent_status',
  'tournament_select',
  'eligible_matches',
  'saved_reports',
  'personal_bundle',
  'personal_podium_strategy',
  'personal_tournament_advisory',
  'leaderboard_analysis',
  'market_analysis',
  'timing_strategy',
  'crowd_contrarian_map',
  'football_context_risk',
  'tournament_position_strategy',
  'alternative_pick_set',
  'decision_preview',
  'approve_plan',
  'freebet_status',
  'refund_status',
  'calibration_report',
  'export_report',
  'strategy_preferences',
  'operator_policy',
  'help',
  'unknown',
] as const;

export type TelegramNaturalLanguageIntent = (typeof telegramNaturalLanguageIntents)[number];

export type TelegramNaturalLanguagePermission = 'user' | 'operator';

export type TelegramNaturalLanguageExecutionSafety =
  | 'read_only'
  | 'decision_preview_only'
  | 'leaderboard_simulation'
  | 'explicit_approval_only'
  | 'stores_local_preference'
  | 'policy_change'
  | 'no_action';

export type TelegramNaturalLanguageSlotName =
  | 'tournamentId'
  | 'matchId'
  | 'matchScope'
  | 'riskMode'
  | 'stakeUsd'
  | 'stakePlanck'
  | 'fundingSource'
  | 'publicWallet'
  | 'decisionId'
  | 'policyMode'
  | 'operatorOnly'
  | 'confidence';

export type TelegramNaturalLanguageMatchScope = 'single_match' | 'next_open_match' | 'next_five_open_matches';

export type TelegramNaturalLanguagePolicyMode =
  | 'read_only'
  | 'approval_required'
  | 'claim_only'
  | 'tournament_autopilot';

export type TelegramNaturalLanguageSlots = {
  tournamentId?: string;
  matchId?: string;
  matchScope?: TelegramNaturalLanguageMatchScope;
  riskMode?: RiskMode;
  stakeUsd?: string;
  stakePlanck?: string;
  fundingSource?: FundingSource;
  publicWallet?: string;
  decisionId?: string;
  policyMode?: TelegramNaturalLanguagePolicyMode;
  operatorOnly?: boolean;
  confidence?: number;
};

export type TelegramNaturalLanguageSlotValueKind =
  | 'string'
  | 'enum'
  | 'decimal_string'
  | 'planck_string'
  | 'boolean'
  | 'confidence';

export type TelegramNaturalLanguageSlotSensitivity =
  | 'public'
  | 'operator_only'
  | 'audit_only'
  | 'secret_rejected';

export type TelegramNaturalLanguageSlotDefinition = {
  slot: TelegramNaturalLanguageSlotName;
  label: string;
  description: string;
  valueKind: TelegramNaturalLanguageSlotValueKind;
  sensitivity: TelegramNaturalLanguageSlotSensitivity;
  acceptedValues?: readonly string[];
  aliases: readonly string[];
  examples: readonly string[];
  validation: {
    requiredFormat: string;
    rejectionMessage: string;
  };
  normalization: string;
};

export const telegramNaturalLanguageSlotDefinitions: Record<
  TelegramNaturalLanguageSlotName,
  TelegramNaturalLanguageSlotDefinition
> = {
  tournamentId: {
    slot: 'tournamentId',
    label: 'Tournament id',
    description: 'Configured tournament profile id used to scope matches, reports, status, and pricing context.',
    valueKind: 'string',
    sensitivity: 'public',
    aliases: ['tournament', 'competition', 'cup', 'league'],
    examples: ['worldcup-2026-mvp', 'World Cup 2026', 'friendly mini tournament'],
    validation: {
      requiredFormat: 'Configured profile id or a name that can resolve to exactly one tournament profile.',
      rejectionMessage: 'I need a known SmartCup tournament before using match ids or tournament stats.',
    },
    normalization: 'Resolve aliases and display names to the configured tournament profile id.',
  },
  matchId: {
    slot: 'matchId',
    label: 'Match id',
    description: 'SmartCup match id in the selected tournament.',
    valueKind: 'string',
    sensitivity: 'public',
    aliases: ['match', 'game', 'fixture'],
    examples: ['3', 'match 4', 'game 12'],
    validation: {
      requiredFormat: 'Positive SmartCup match id, optionally inferred from next-open-match language.',
      rejectionMessage: 'I need a valid SmartCup match id or a clear next-open-match instruction.',
    },
    normalization: 'Strip match/game labels and keep the numeric SmartCup match id as a string.',
  },
  matchScope: {
    slot: 'matchScope',
    label: 'Match scope',
    description: 'Whether the user means one explicit match, the next open match, or the next five open matches.',
    valueKind: 'enum',
    sensitivity: 'public',
    acceptedValues: ['single_match', 'next_open_match', 'next_five_open_matches'],
    aliases: ['scope', 'next match', 'next game', 'next five', 'bundle'],
    examples: ['single_match', 'next_open_match', 'next_five_open_matches'],
    validation: {
      requiredFormat: 'single_match, next_open_match, or next_five_open_matches.',
      rejectionMessage: 'I need to know whether you want one match or the next five open matches.',
    },
    normalization: 'Map phrases like “next game” to next_open_match and “next five” to next_five_open_matches.',
  },
  riskMode: {
    slot: 'riskMode',
    label: 'Risk mode',
    description: 'Prediction risk mode, simulation objective, or strategy posture requested by the user.',
    valueKind: 'enum',
    sensitivity: 'public',
    acceptedValues: ['conservative', 'balanced', 'contrarian', 'catch_up', 'protect_lead', 'final_swing'],
    aliases: ['risk', 'mode', 'objective', 'strategy', 'posture'],
    examples: ['balanced', 'contrarian', 'catch_up', 'protect_lead'],
    validation: {
      requiredFormat: 'conservative, balanced, contrarian, catch_up, protect_lead, or final_swing.',
      rejectionMessage: 'Risk mode must be conservative, balanced, contrarian, catch_up, protect_lead, or final_swing.',
    },
    normalization: 'Map natural phrases like “protect my lead” to protect_lead and “catch up” to catch_up.',
  },
  stakeUsd: {
    slot: 'stakeUsd',
    label: 'Stake USD',
    description: 'Operator-requested stake expressed in USD before conversion to VARA planck.',
    valueKind: 'decimal_string',
    sensitivity: 'operator_only',
    aliases: ['usd', 'dollars', '$', 'stake dollars'],
    examples: ['3', '3.25', '$5'],
    validation: {
      requiredFormat: 'Positive decimal USD amount that satisfies configured min/max stake policy.',
      rejectionMessage: 'Stake USD must be a positive amount within the configured SmartPredictor policy limits.',
    },
    normalization: 'Strip currency symbols and keep a decimal string for Oracle/Bolao price conversion.',
  },
  stakePlanck: {
    slot: 'stakePlanck',
    label: 'Stake planck',
    description: 'Operator-requested raw VARA planck value attached to a transaction plan.',
    valueKind: 'planck_string',
    sensitivity: 'operator_only',
    aliases: ['planck', 'raw stake', 'stake'],
    examples: ['4500000000000000', '5327868852459017'],
    validation: {
      requiredFormat: 'Positive integer planck amount that satisfies configured min/max stake policy.',
      rejectionMessage: 'Stake planck must be a positive integer within configured SmartPredictor policy limits.',
    },
    normalization: 'Keep digits only; prefer stakeUsd for human Telegram interactions.',
  },
  fundingSource: {
    slot: 'fundingSource',
    label: 'Funding source',
    description: 'Whether the decision economics should treat the stake as cash capital or freebet-backed value.',
    valueKind: 'enum',
    sensitivity: 'public',
    acceptedValues: ['cash', 'freebet'],
    aliases: ['funding', 'source', 'freebet', 'cash'],
    examples: ['cash', 'freebet'],
    validation: {
      requiredFormat: 'cash or freebet.',
      rejectionMessage: 'Funding source must be cash or freebet.',
    },
    normalization: 'Default to cash unless the user explicitly requests freebet and freebet readiness is proven later.',
  },
  publicWallet: {
    slot: 'publicWallet',
    label: 'Public wallet',
    description: 'Public 0x wallet address for freebet or claim checks.',
    valueKind: 'string',
    sensitivity: 'public',
    aliases: ['wallet', 'address', 'public key', '0x address'],
    examples: ['0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
    validation: {
      requiredFormat: '0x-prefixed public wallet address. Secrets are rejected.',
      rejectionMessage: 'Send only a public 0x wallet address. Never send a mnemonic, seed phrase, private key, or wallet JSON.',
    },
    normalization: 'Lowercase public 0x address; reject secret-looking input.',
  },
  decisionId: {
    slot: 'decisionId',
    label: 'Decision id',
    description: 'Saved DecisionReport id used by the approval flow.',
    valueKind: 'string',
    sensitivity: 'operator_only',
    aliases: ['decision', 'report id', 'plan'],
    examples: ['decision-3-balanced-2-1-1780502534986'],
    validation: {
      requiredFormat: 'Existing saved decision id from local memory.',
      rejectionMessage: 'I need an existing saved decision id before approval can be prepared.',
    },
    normalization: 'Keep exact id string and verify existence during routing.',
  },
  policyMode: {
    slot: 'policyMode',
    label: 'Policy mode',
    description: 'Operator execution policy for local guarded transaction behavior.',
    valueKind: 'enum',
    sensitivity: 'operator_only',
    acceptedValues: ['read_only', 'approval_required', 'claim_only', 'tournament_autopilot'],
    aliases: ['policy', 'mode', 'execution mode'],
    examples: ['read_only', 'approval_required', 'claim_only'],
    validation: {
      requiredFormat: 'read_only, approval_required, claim_only, or tournament_autopilot.',
      rejectionMessage: 'Policy mode must be read_only, approval_required, claim_only, or tournament_autopilot.',
    },
    normalization: 'Lowercase and replace spaces/hyphens with underscores.',
  },
  operatorOnly: {
    slot: 'operatorOnly',
    label: 'Operator-only flag',
    description: 'Audit flag indicating that a parsed intent requires admin/operator permissions.',
    valueKind: 'boolean',
    sensitivity: 'audit_only',
    aliases: ['admin only', 'operator only'],
    examples: ['true', 'false'],
    validation: {
      requiredFormat: 'Boolean parser/router flag derived from the resolved intent permission.',
      rejectionMessage: 'This action requires an operator Telegram user id.',
    },
    normalization: 'Derived by the router from intent permission; user text should not override it.',
  },
  confidence: {
    slot: 'confidence',
    label: 'Parser confidence',
    description: 'Parser confidence score used for clarification, telemetry, and unknown-intent fallback.',
    valueKind: 'confidence',
    sensitivity: 'audit_only',
    aliases: ['confidence', 'score'],
    examples: ['0.82', '1'],
    validation: {
      requiredFormat: 'Number from 0 to 1.',
      rejectionMessage: 'Parser confidence must be between 0 and 1.',
    },
    normalization: 'Clamp parser-produced confidence to the 0..1 range.',
  },
};

export type TelegramNaturalLanguageParsedIntent = {
  intent: TelegramNaturalLanguageIntent;
  slots: TelegramNaturalLanguageSlots;
  confidence: number;
  missingRequiredSlots: TelegramNaturalLanguageSlotName[];
  ambiguousSlots: TelegramNaturalLanguageSlotName[];
  safety: TelegramNaturalLanguageExecutionSafety;
  permission: TelegramNaturalLanguagePermission;
};

export type TelegramNaturalLanguageIntentDefinition = {
  intent: TelegramNaturalLanguageIntent;
  description: string;
  permission: TelegramNaturalLanguagePermission;
  safety: TelegramNaturalLanguageExecutionSafety;
  requiredSlots: TelegramNaturalLanguageSlotName[];
  optionalSlots: TelegramNaturalLanguageSlotName[];
  routesTo:
    | TelegramCommand
    | 'menu'
    | 'eligible_match_picker'
    | 'refund_status'
    | 'risk|objective|strategy'
    | 'personal_bundle'
    | 'personal_podium'
    | 'personal_advisory'
    | 'calibration'
    | 'export_report'
    | 'none';
  examples: string[];
  clarification: string;
};

export const telegramNaturalLanguageIntentDefinitions: Record<
  TelegramNaturalLanguageIntent,
  TelegramNaturalLanguageIntentDefinition
> = {
  agent_status: {
    intent: 'agent_status',
    description: 'Show connected agent wallet, nickname, active tournament, prediction count, balance, points, and rank data.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId'],
    routesTo: 'agent_status',
    examples: ['show my agent status', 'how is smartpredictor doing in the world cup?', 'show wallet and points'],
    clarification: 'Which tournament status should I show?',
  },
  tournament_select: {
    intent: 'tournament_select',
    description: 'Open the guided menu, optionally selecting a SmartCup tournament context first.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId'],
    routesTo: 'menu',
    examples: [
      'show me the menu option',
      'open the menu',
      'use the world cup tournament',
      'switch to worldcup 2026',
    ],
    clarification: 'Which tournament should I use?',
  },
  eligible_matches: {
    intent: 'eligible_matches',
    description: 'Show open, unpredicted, outside-cutoff matches for the selected tournament.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId', 'matchScope', 'publicWallet'],
    routesTo: 'eligible_match_picker',
    examples: ['show eligible matches', 'what games can I still predict?', 'show the next five open games'],
    clarification: 'Do you want one next open match or the next five open matches?',
  },
  saved_reports: {
    intent: 'saved_reports',
    description: 'List saved personal operator DecisionReports for the selected tournament.',
    permission: 'operator',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId'],
    routesTo: 'none',
    examples: ['show my saved reports', 'list saved decisions', 'show saved prediction reports'],
    clarification: 'Which tournament saved reports should I list?',
  },
  personal_bundle: {
    intent: 'personal_bundle',
    description: 'Build the personal no-charge five-match bundle for the connected operator wallet.',
    permission: 'operator',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId', 'riskMode', 'matchScope'],
    routesTo: 'personal_bundle',
    examples: [
      'build my personal five-match bundle',
      'give me the next five open matches as a personal bundle',
      'run a free 5-match bundle for my agent',
    ],
    clarification: 'Which tournament should I use for the personal five-match bundle?',
  },
  personal_podium_strategy: {
    intent: 'personal_podium_strategy',
    description:
      'Build the personal podium strategy for the selected tournament and offer an explicit guarded approval button when submission is possible.',
    permission: 'operator',
    safety: 'explicit_approval_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId'],
    routesTo: 'personal_podium',
    examples: [
      'give me my personal podium strategy',
      'show podium strategy',
      'show champion runner-up and third-place strategy',
      'build podium strategy for my agent',
    ],
    clarification: 'Which tournament should I use for the personal podium strategy?',
  },
  personal_tournament_advisory: {
    intent: 'personal_tournament_advisory',
    description: 'Build the personal rolling tournament advisory for the connected operator wallet.',
    permission: 'operator',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId', 'riskMode'],
    routesTo: 'personal_advisory',
    examples: [
      'give me my tournament advisory',
      'build a personal tournament advisory',
      'show my rolling tournament plan',
    ],
    clarification: 'Which tournament should I use for the personal tournament advisory?',
  },
  leaderboard_analysis: {
    intent: 'leaderboard_analysis',
    description: 'Run a read-only competitor and leaderboard simulation for a match without saving a decision.',
    permission: 'operator',
    safety: 'leaderboard_simulation',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_simulate',
    examples: [
      'analyze competitors and leaderboard for the next open match',
      'simulate leaderboard for match 4 balanced risk',
      'show competitor analysis for the next open match',
    ],
    clarification: 'Which match should I simulate for competitor and leaderboard analysis?',
  },
  market_analysis: {
    intent: 'market_analysis',
    description: 'Compare agent probabilities with bookmaker implied probabilities for a match.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'compare the next open match to the market',
      'show bookmaker implied probability for match 4',
      'show odds edge for the next open match',
    ],
    clarification: 'Which match should I compare against bookmaker market odds?',
  },
  timing_strategy: {
    intent: 'timing_strategy',
    description: 'Analyze whether to predict now or wait closer to kickoff before approving a final pick.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'should I predict now or wait for the next open match?',
      'timing strategy for match 4',
      'wait closer to kickoff or predict now?',
    ],
    clarification: 'Which match should I analyze for prediction timing?',
  },
  crowd_contrarian_map: {
    intent: 'crowd_contrarian_map',
    description: 'Show likely public score clusters and differentiated score opportunities for a match.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'show contrarian map for match 4',
      'where is the crowd on the next open match?',
      'show public score clusters for the next open match',
    ],
    clarification: 'Which match should I analyze for public crowding and contrarian score opportunities?',
  },
  football_context_risk: {
    intent: 'football_context_risk',
    description: 'Show lineup, injury, suspension, and news-risk freshness/uncertainty for a match.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'show injury and lineup risk for match 4',
      'any suspensions for the next open match?',
      'lineup news risk for the next open match',
    ],
    clarification: 'Which match should I analyze for lineup, injury, suspension, and news risk?',
  },
  tournament_position_strategy: {
    intent: 'tournament_position_strategy',
    description: 'Show leading, mid-table, catch-up, or final-swing posture from rank and points gaps.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'tournament position strategy for match 4',
      'should I protect lead or catch up for the next open match?',
      'what posture should I use based on rank gap?',
    ],
    clarification: 'Which match should I analyze for tournament position and rank-gap strategy?',
  },
  alternative_pick_set: {
    intent: 'alternative_pick_set',
    description: 'Show safest, balanced, contrarian, and leaderboard-upside alternatives for a match.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'show alternative picks for match 4',
      'give me safest balanced contrarian and leaderboard upside picks for the next open match',
      'what are the four pick options for the next open match?',
    ],
    clarification: 'Which match should I analyze for safest, balanced, contrarian, and leaderboard-upside picks?',
  },
  decision_preview: {
    intent: 'decision_preview',
    description: 'Generate a saved DecisionReport preview for a match without submitting funds.',
    permission: 'operator',
    safety: 'decision_preview_only',
    requiredSlots: ['matchId'],
    optionalSlots: ['tournamentId', 'riskMode', 'stakeUsd', 'stakePlanck', 'fundingSource', 'matchScope'],
    routesTo: 'operator_decide',
    examples: [
      'analyze match 4 with balanced risk and 3.25 dollars',
      'prepare a prediction for the next open match',
      'preview match 5 contrarian mode',
    ],
    clarification: 'Which match should I analyze before preparing the decision preview?',
  },
  approve_plan: {
    intent: 'approve_plan',
    description: 'Approve an existing saved decision through the structured approval flow.',
    permission: 'operator',
    safety: 'explicit_approval_only',
    requiredSlots: ['decisionId'],
    optionalSlots: [],
    routesTo: 'operator_approve',
    examples: ['approve decision decision-3-balanced-2-1', 'submit the saved plan', 'approve this plan'],
    clarification: 'Which saved decision id should I approve?',
  },
  freebet_status: {
    intent: 'freebet_status',
    description: 'Check configured Freebet Ledger status and wallet freebet balance when available.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['publicWallet'],
    routesTo: 'freebet',
    examples: ['check my freebet balance', 'do I have freebets?', 'freebet status for this wallet'],
    clarification: 'Which public 0x wallet should I check?',
  },
  refund_status: {
    intent: 'refund_status',
    description: 'Check SmartCup match reward, final prize, and refund-recovery claim status for the configured or provided wallet.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['publicWallet'],
    routesTo: 'claim_status',
    examples: ['check claim status', 'do I have anything to claim?', 'claim pending rewards', 'claim status for my wallet'],
    clarification: 'Which public 0x wallet should I check for claimable rewards?',
  },
  calibration_report: {
    intent: 'calibration_report',
    description: 'Render the local post-match calibration report for saved personal predictions.',
    permission: 'operator',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId', 'matchId'],
    routesTo: 'calibration',
    examples: [
      'show calibration',
      'calibration report for my predictions',
      'show predicted probability versus actual results',
    ],
    clarification: 'Which tournament should I use for the calibration report?',
  },
  export_report: {
    intent: 'export_report',
    description: 'Open the personal saved-report export flow for Markdown or JSON output.',
    permission: 'operator',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: ['tournamentId'],
    routesTo: 'export_report',
    examples: [
      'export my latest report',
      'export saved reports as markdown',
      'give me JSON export for my decisions',
    ],
    clarification: 'Which tournament should I use for the report export?',
  },
  strategy_preferences: {
    intent: 'strategy_preferences',
    description: 'Show or update default risk, simulation objective, and strategy posture preferences.',
    permission: 'user',
    safety: 'stores_local_preference',
    requiredSlots: [],
    optionalSlots: ['tournamentId', 'riskMode'],
    routesTo: 'risk|objective|strategy',
    examples: [
      'set risk to contrarian',
      'use conservative mode',
      'change objective to catch up',
      'protect my lead',
      'use final swing strategy',
      'show my strategy settings',
    ],
    clarification: 'Which strategy preference should I show or update?',
  },
  operator_policy: {
    intent: 'operator_policy',
    description: 'Show or change the operator execution policy.',
    permission: 'operator',
    safety: 'policy_change',
    requiredSlots: [],
    optionalSlots: ['policyMode'],
    routesTo: 'operator_policy',
    examples: ['show policy mode', 'switch to read only', 'set approval required'],
    clarification: 'Which policy mode should I use: read_only, approval_required, claim_only, or tournament_autopilot?',
  },
  help: {
    intent: 'help',
    description: 'Show command help, safety rules, and natural-language examples.',
    permission: 'user',
    safety: 'read_only',
    requiredSlots: [],
    optionalSlots: [],
    routesTo: 'help',
    examples: ['help', 'what can you do?', 'show commands'],
    clarification: 'I can show help, agent status, eligible matches, personal reports, strategy settings, or operator actions.',
  },
  unknown: {
    intent: 'unknown',
    description: 'Fallback for unsupported or low-confidence natural-language messages.',
    permission: 'user',
    safety: 'no_action',
    requiredSlots: [],
    optionalSlots: ['confidence'],
    routesTo: 'none',
    examples: ['something unclear', 'unsupported request', 'low confidence parse'],
    clarification: 'I did not understand that yet. Try /menu, /help, or ask for agent status, eligible matches, saved reports, or a prediction preview.',
  },
};

export function isTelegramNaturalLanguageIntent(value: string): value is TelegramNaturalLanguageIntent {
  return (telegramNaturalLanguageIntents as readonly string[]).includes(value);
}

export function isTelegramNaturalLanguageSlotName(value: string): value is TelegramNaturalLanguageSlotName {
  return Object.hasOwn(telegramNaturalLanguageSlotDefinitions, value);
}

export function getTelegramNaturalLanguageIntentDefinition(
  intent: TelegramNaturalLanguageIntent,
): TelegramNaturalLanguageIntentDefinition {
  return telegramNaturalLanguageIntentDefinitions[intent];
}

export function getTelegramNaturalLanguageSlotDefinition(
  slot: TelegramNaturalLanguageSlotName,
): TelegramNaturalLanguageSlotDefinition {
  return telegramNaturalLanguageSlotDefinitions[slot];
}
