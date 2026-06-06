import type { FundingSource, RiskMode } from '../types/index.js';
import {
  getTelegramNaturalLanguageIntentDefinition,
  type TelegramNaturalLanguageIntent,
  type TelegramNaturalLanguageMatchScope,
  type TelegramNaturalLanguageParsedIntent,
  type TelegramNaturalLanguagePolicyMode,
  type TelegramNaturalLanguageSlotName,
  type TelegramNaturalLanguageSlots,
} from './natural-language-intents.js';

export type TelegramNaturalLanguageTournamentHint = {
  id: string;
  name: string;
  slug?: string;
  aliases?: readonly string[];
};

export type TelegramNaturalLanguageParserOptions = {
  tournaments?: readonly TelegramNaturalLanguageTournamentHint[];
};

type IntentCandidate = {
  intent: TelegramNaturalLanguageIntent;
  confidence: number;
};

const walletPattern = /\b0x[a-fA-F0-9]{64}\b/;
const decisionPattern = /\bdecision-[A-Za-z0-9_.:-]+\b/;
const tournamentStopwords = new Set([
  'am',
  'are',
  'current',
  'active',
  'default',
  'i',
  'is',
  'me',
  'my',
  'now',
  'selected',
  'show',
  'status',
  'the',
  'to',
  'use',
  'using',
  'what',
  'which',
]);

export function parseTelegramNaturalLanguage(
  text: string,
  options: TelegramNaturalLanguageParserOptions = {},
): TelegramNaturalLanguageParsedIntent {
  const raw = text.trim();
  const normalized = normalizeText(raw);
  const slots = extractSlots(raw, normalized, options);
  const intent = chooseIntent(normalized, slots);
  const definition = getTelegramNaturalLanguageIntentDefinition(intent.intent);
  const missingRequiredSlots = definition.requiredSlots.filter((slot) => !hasSlot(slots, slot));
  const ambiguousSlots = findAmbiguousSlots(raw, normalized, options);
  const confidence = clamp(intent.confidence - ambiguousSlots.length * 0.08 - missingRequiredSlots.length * 0.05);

  return {
    intent: intent.intent,
    slots: {
      ...slots,
      operatorOnly: definition.permission === 'operator',
      confidence,
    },
    confidence,
    missingRequiredSlots,
    ambiguousSlots,
    safety: definition.safety,
    permission: definition.permission,
  };
}

function extractSlots(
  raw: string,
  normalized: string,
  options: TelegramNaturalLanguageParserOptions,
): TelegramNaturalLanguageSlots {
  const slots: TelegramNaturalLanguageSlots = {};
  const semanticNormalized = normalizeText(
    raw.replace(decisionPattern, ' ').replace(walletPattern, ' '),
  );
  const tournamentId = extractTournamentId(raw, normalized, options);
  const matchId = extractMatchId(raw);
  const matchScope = extractMatchScope(semanticNormalized);
  const riskMode =
    isAlternativePickSetRequest(semanticNormalized) && !hasExplicitRiskModeLanguage(semanticNormalized)
      ? null
      : extractRiskMode(semanticNormalized);
  const stakeUsd = extractStakeUsd(raw);
  const stakePlanck = extractStakePlanck(raw);
  const fundingSource = extractFundingSource(semanticNormalized);
  const publicWallet = extractPublicWallet(raw);
  const decisionId = raw.match(decisionPattern)?.[0];
  const policyMode = extractPolicyMode(semanticNormalized);

  if (tournamentId) slots.tournamentId = tournamentId;
  if (matchId) slots.matchId = matchId;
  if (matchScope) slots.matchScope = matchScope;
  if (riskMode) slots.riskMode = riskMode;
  if (stakeUsd) slots.stakeUsd = stakeUsd;
  if (stakePlanck) slots.stakePlanck = stakePlanck;
  if (fundingSource) slots.fundingSource = fundingSource;
  if (publicWallet) slots.publicWallet = publicWallet;
  if (decisionId) slots.decisionId = decisionId;
  if (policyMode) slots.policyMode = policyMode;

  return slots;
}

function chooseIntent(normalized: string, slots: TelegramNaturalLanguageSlots): IntentCandidate {
  const candidates: IntentCandidate[] = [];

  if (
    matches(normalized, [
      'menu',
      'main menu',
      'guided menu',
      'open menu',
      'open the menu',
      'show menu',
      'show me the menu',
      'show menu option',
      'show menu options',
      'show me the menu option',
      'show me the menu options',
      'menu option',
      'menu options',
      'buttons',
      'show buttons',
      'guided buttons',
    ])
  ) {
    candidates.push({ intent: 'tournament_select', confidence: 0.96 });
  }

  if (matches(normalized, ['help', 'commands', 'what can you do', 'how do i use'])) {
    candidates.push({ intent: 'help', confidence: 0.94 });
  }

  if (matches(normalized, ['freebet', 'free bet', 'incentive'])) {
    candidates.push({ intent: 'freebet_status', confidence: 0.9 });
  }

  if (
    matches(normalized, [
      'claim status',
      'claimable',
      'anything to claim',
      'refund',
      'claim back',
      'claim pending',
      'claim pending rewards',
      'claim available',
      'claim rewards',
      'claim my rewards',
      'claim prizes',
      'claim what is pending',
    ])
  ) {
    candidates.push({ intent: 'refund_status', confidence: 0.9 });
  }

  if (
    matches(normalized, ['policy', 'execution mode', 'read only', 'approval required', 'claim only', 'autopilot']) ||
    slots.policyMode
  ) {
    candidates.push({ intent: 'operator_policy', confidence: slots.policyMode ? 0.91 : 0.82 });
  }

  if (
    isStrategyPreferenceRequest(normalized, slots) &&
    !matches(normalized, ['policy', 'execution mode', 'read only', 'approval required', 'claim only', 'autopilot'])
  ) {
    candidates.push({ intent: 'strategy_preferences', confidence: slots.riskMode ? 0.88 : 0.8 });
  }

  if (
    matches(normalized, ['approve', 'submit', 'execute', 'send it', 'place bet', 'bet this']) ||
    slots.decisionId
  ) {
    candidates.push({ intent: 'approve_plan', confidence: slots.decisionId ? 0.86 : 0.68 });
  }

  if (
    matches(normalized, [
      'tournament position',
      'position strategy',
      'rank gap',
      'points gap',
      'leader gap',
      'protect lead or catch up',
      'leading strategy',
      'mid table strategy',
      'mid-table strategy',
      'catch up strategy',
      'final swing strategy',
      'what posture',
      'posture should i use',
      'based on rank',
      'based on points gap',
    ])
  ) {
    candidates.push({
      intent: 'tournament_position_strategy',
      confidence: slots.matchId || slots.matchScope ? 0.91 : 0.8,
    });
  }

  if (
    matches(normalized, [
      'alternative picks',
      'pick alternatives',
      'four picks',
      'four pick options',
      'safest pick',
      'safe pick',
      'balanced pick',
      'contrarian pick',
      'leaderboard upside',
      'leaderboard-upside',
      'upside pick',
      'safest balanced contrarian',
    ])
  ) {
    candidates.push({
      intent: 'alternative_pick_set',
      confidence: slots.matchId || slots.matchScope ? 0.94 : 0.86,
    });
  }

  if (
    matches(normalized, [
      'personal bundle',
      'personal 5 match bundle',
      'personal 5-match bundle',
      'personal five match bundle',
      'personal five-match bundle',
      'my bundle',
      'my 5 match bundle',
      'my 5-match bundle',
      'my five match bundle',
      'my five-match bundle',
      'next five open matches',
      'next 5 open matches',
      'next five open games',
      'next 5 open games',
      'free bundle',
      'agent bundle',
    ]) &&
    !isExternalServiceLanguage(normalized)
  ) {
    candidates.push({
      intent: 'personal_bundle',
      confidence: 0.9,
    });
  }

  if (
    matches(normalized, [
      'personal podium',
      'personal podium strategy',
      'my podium strategy',
      'show podium strategy',
      'show me podium strategy',
      'agent podium strategy',
      'podium strategy for my agent',
      'champion runner up third place strategy',
      'champion runner-up third-place strategy',
      'champion runner up and third place',
      'champion runner-up and third-place',
    ]) &&
    !isExternalServiceLanguage(normalized)
  ) {
    candidates.push({
      intent: 'personal_podium_strategy',
      confidence: 0.9,
    });
  }

  if (
    matches(normalized, [
      'personal tournament advisory',
      'my tournament advisory',
      'agent tournament advisory',
      'tournament advisory for my agent',
      'personal rolling advisory',
      'rolling tournament plan',
      'my tournament plan',
      'tournament plan for my agent',
      'personal tournament plan',
    ]) &&
    !isExternalServiceLanguage(normalized)
  ) {
    candidates.push({
      intent: 'personal_tournament_advisory',
      confidence: 0.9,
    });
  }

  if (
    matches(normalized, [
      'leaderboard',
      'competitor',
      'competitors',
      'opponent',
      'opponents',
      'simulate',
      'simulation',
      'top five',
      'top-5',
      'rank impact',
    ])
  ) {
    candidates.push({
      intent: 'leaderboard_analysis',
      confidence: slots.matchId || slots.matchScope ? 0.9 : 0.8,
    });
  }

  if (
    matches(normalized, [
      'market',
      'odds',
      'bookmaker',
      'bookmakers',
      'implied probability',
      'market edge',
      'odds edge',
      'value edge',
      'betting market',
      'compare to market',
      'compare this pick',
    ])
  ) {
    candidates.push({
      intent: 'market_analysis',
      confidence: slots.matchId || slots.matchScope ? 0.91 : 0.78,
    });
  }

  if (
    matches(normalized, [
      'timing',
      'timing strategy',
      'predict now',
      'wait closer',
      'wait closer to kickoff',
      'wait or predict',
      'predict or wait',
      'should i wait',
      'should i predict now',
      'when should i predict',
      'when to predict',
      'refresh later',
    ])
  ) {
    candidates.push({
      intent: 'timing_strategy',
      confidence: slots.matchId || slots.matchScope ? 0.91 : 0.78,
    });
  }

  if (
    matches(normalized, [
      'contrarian map',
      'crowd map',
      'crowding map',
      'public score',
      'public scores',
      'public score cluster',
      'public score clusters',
      'score cluster',
      'score clusters',
      'where is the crowd',
      'crowd on',
      'crowd leaning',
      'differentiated score',
      'differentiated scores',
      'differentiated opportunity',
      'contrarian opportunity',
    ])
  ) {
    candidates.push({
      intent: 'crowd_contrarian_map',
      confidence: slots.matchId || slots.matchScope ? 0.91 : 0.78,
    });
  }

  if (
    matches(normalized, [
      'lineup',
      'lineups',
      'injury',
      'injuries',
      'suspension',
      'suspensions',
      'availability',
      'team news',
      'news risk',
      'lineup news',
      'context risk',
      'football context',
      'player availability',
      'who is out',
      'any suspensions',
      'any injuries',
    ])
  ) {
    candidates.push({
      intent: 'football_context_risk',
      confidence: slots.matchId || slots.matchScope ? 0.91 : 0.78,
    });
  }

  if (
    matches(normalized, ['analyze', 'analyse', 'predict', 'prediction', 'preview', 'prepare', 'recommend']) &&
    !matches(normalized, [
        'price',
      'cost',
      'leaderboard',
      'competitor',
      'competitors',
      'opponent',
      'opponents',
      'simulate',
      'market',
      'odds',
      'bookmaker',
      'bookmakers',
      'implied probability',
      'market edge',
      'odds edge',
      'timing',
      'wait closer',
      'wait or predict',
      'predict or wait',
      'should i wait',
      'when should i predict',
      'contrarian map',
      'crowd map',
      'crowding map',
      'public score',
      'score cluster',
      'where is the crowd',
      'differentiated score',
      'lineup',
      'injury',
      'suspension',
      'team news',
      'news risk',
      'availability',
      'tournament position',
      'position strategy',
      'rank gap',
      'points gap',
      'leader gap',
      'protect lead or catch up',
      'leading strategy',
      'mid table strategy',
      'mid-table strategy',
      'catch up strategy',
      'final swing strategy',
      'what posture',
      'posture should i use',
      'based on rank',
      'based on points gap',
      'alternative picks',
      'pick alternatives',
      'four picks',
      'four pick options',
      'safest pick',
      'safe pick',
      'balanced pick',
      'contrarian pick',
      'leaderboard upside',
      'leaderboard-upside',
      'upside pick',
      'safest balanced contrarian',
    ])
  ) {
    candidates.push({
      intent: 'decision_preview',
      confidence: slots.matchId || slots.matchScope ? 0.86 : 0.74,
    });
  }

  if (
    matches(normalized, ['eligible', 'open matches', 'open games', 'can i predict', 'available matches']) ||
    (slots.matchScope && matches(normalized, ['show', 'list', 'what']))
  ) {
    candidates.push({ intent: 'eligible_matches', confidence: slots.matchScope ? 0.82 : 0.78 });
  }

  if (
    matches(normalized, [
      'saved reports',
      'saved report',
      'saved decisions',
      'saved decision',
      'saved prediction reports',
      'saved predictions',
      'my reports',
      'list reports',
      'list decisions',
    ])
  ) {
    candidates.push({ intent: 'saved_reports', confidence: 0.86 });
  }

  if (
    matches(normalized, [
      'calibration',
      'calibration report',
      'post match calibration',
      'post-match calibration',
      'prediction calibration',
      'predicted probability versus actual',
      'predicted probability vs actual',
      'brier',
      'log loss',
      'log-loss',
    ])
  ) {
    candidates.push({ intent: 'calibration_report', confidence: 0.88 });
  }

  if (
    matches(normalized, [
      'export report',
      'export reports',
      'export saved report',
      'export saved reports',
      'export my report',
      'export my reports',
      'export my latest report',
      'export my latest decision',
      'export latest personal report',
      'export latest personal decision',
      'markdown export',
      'json export',
      'export latest report',
      'export latest decision',
      'export decisions',
    ])
  ) {
    candidates.push({ intent: 'export_report', confidence: 0.88 });
  }

  if (
    (matches(normalized, [
      'agent status',
      'my status',
      'wallet status',
      'active tournament',
      'current tournament',
      'selected tournament',
      'progress',
      'points',
      'rank',
      'how am i doing',
      'how is the agent doing',
      'how is smartpredictor doing',
      'show my stats',
      'show stats',
      'show active tournament',
      'what tournament',
      'which tournament',
      'tournament stats',
    ]) ||
      /\bbalance\b/.test(normalized)) &&
    !matches(normalized, ['freebet', 'refund'])
  ) {
    candidates.push({ intent: 'agent_status', confidence: 0.82 });
  }

  if (isTournamentSelectionRequest(normalized)) {
    candidates.push({ intent: 'tournament_select', confidence: slots.tournamentId ? 0.85 : 0.7 });
  }

  const selected = candidates.sort((left, right) => right.confidence - left.confidence)[0];
  return selected ?? { intent: 'unknown', confidence: 0.2 };
}

function extractTournamentId(
  raw: string,
  normalized: string,
  options: TelegramNaturalLanguageParserOptions,
): string | null {
  const matches = tournamentMatches(normalized, options);
  if (matches.length === 1) return matches[0]?.id ?? null;

  if (isWorldCupAlias(normalized)) {
    return 'worldcup-2026-mvp';
  }

  const keyed = raw.match(/\btournament(?:\s+(?:id|slug))?\s*[:=]\s*([A-Za-z0-9_.-]+)/i)?.[1];
  const keyedResolved = resolveTournamentCandidate(keyed, options);
  if (keyedResolved) return keyedResolved;

  const selectionTarget =
    raw.match(/\b(?:select|switch|use|change)\s+(?:to\s+)?(?:the\s+)?tournament\s+(?:to\s+)?([A-Za-z0-9_. -]{2,80})/i)?.[1] ??
    raw.match(/\b(?:select|switch|use|change)\s+(?:to\s+)?(?:the\s+)?([A-Za-z0-9_. -]{2,80})/i)?.[1];
  const selectionResolved = resolveTournamentCandidate(selectionTarget, options);
  if (selectionResolved) return selectionResolved;

  return null;
}

function tournamentMatches(
  normalized: string,
  options: TelegramNaturalLanguageParserOptions,
): TelegramNaturalLanguageTournamentHint[] {
  return (options.tournaments ?? []).filter((tournament) => {
    const names = tournamentAliases(tournament).map(normalizeText);
    return names.some((name) => name && normalized.includes(name));
  });
}

function tournamentAliases(tournament: TelegramNaturalLanguageTournamentHint): string[] {
  const aliases = new Set<string>([
    tournament.id,
    tournament.name,
    tournament.slug ?? '',
    ...(tournament.aliases ?? []),
  ]);
  const normalizedName = normalizeText(tournament.name);
  if (/\bworld cup\b/.test(normalizedName)) {
    aliases.add('World Cup');
    aliases.add('World Cup 2026');
    aliases.add('SmartCup World Cup');
    aliases.add('SmartCup World Cup 2026');
    aliases.add('WC 2026');
  }
  if (/\bmvp\b/.test(normalizedName) || /\bmvp\b/.test(normalizeText(tournament.id))) {
    aliases.add('MVP');
  }
  return [...aliases].filter(Boolean);
}

function resolveTournamentCandidate(
  candidate: string | null | undefined,
  options: TelegramNaturalLanguageParserOptions,
): string | null {
  const normalized = cleanTournamentCandidate(candidate);
  if (!normalized) return null;
  if (isWorldCupAlias(normalized)) return 'worldcup-2026-mvp';

  const matches = tournamentMatches(normalized, options);
  if (matches.length === 1) return matches[0]?.id ?? null;

  return null;
}

function cleanTournamentCandidate(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const normalized = normalizeText(candidate)
    .replace(/\b(please|thanks|thank you|now|current|active|selected|profile|context)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (tournamentStopwords.has(normalized)) return null;
  return normalized;
}

function isWorldCupAlias(normalized: string): boolean {
  return /\b(world cup|worldcup|wc 2026|world cup 2026|smartcup world cup|smartcup world cup 2026)\b/.test(normalized);
}

function isTournamentSelectionRequest(normalized: string): boolean {
  return (
    matches(normalized, ['select tournament', 'switch tournament', 'use tournament', 'change tournament']) ||
    /\b(?:select|switch|use|change)\s+(?:to\s+)?(?:the\s+)?(?:world cup|worldcup|wc 2026|smartcup world cup|mvp)\b/.test(
      normalized,
    ) ||
    /\b(?:select|switch|use|change)\s+(?:to\s+)?(?:the\s+)?tournament\s+(?:to\s+)?\S+/.test(normalized)
  );
}

function isStrategyPreferenceRequest(normalized: string, slots: TelegramNaturalLanguageSlots): boolean {
  return (
    matches(normalized, [
      'strategy settings',
      'strategy preferences',
      'show my strategy',
      'show strategy',
      'set risk',
      'change risk',
      'default risk',
      'set objective',
      'change objective',
      'simulation objective',
      'set strategy',
      'change strategy',
      'strategy posture',
      'use conservative mode',
      'use balanced mode',
      'use contrarian mode',
      'use final swing strategy',
      'protect my lead',
      'protect the lead',
    ]) ||
    (Boolean(slots.riskMode) && matches(normalized, ['set', 'change', 'use', 'default', 'mode', 'strategy', 'objective']))
  );
}

function extractMatchId(raw: string): string | null {
  return (
    raw.match(/\b(?:match|game|fixture)\s*#?\s*:?\s*(\d+)\b/i)?.[1] ??
    raw.match(/\b#(\d+)\b/)?.[1] ??
    null
  );
}

function extractMatchScope(normalized: string): TelegramNaturalLanguageMatchScope | null {
  if (/\b(next|open|upcoming).*(five|5)\b/.test(normalized) || /\b(five|5).*(open|upcoming|matches|games)\b/.test(normalized)) {
    return 'next_five_open_matches';
  }
  if (/\bnext (open )?(match|game|fixture)\b/.test(normalized) || /\bnext open\b/.test(normalized)) {
    return 'next_open_match';
  }
  if (/\b(match|game|fixture)\s*#?\s*:?\s*\d+\b/.test(normalized)) return 'single_match';
  return null;
}

function extractRiskMode(normalized: string): RiskMode | null {
  if (/\b(conservative|safe|cautious)\b/.test(normalized)) return 'conservative';
  if (/\b(balanced|normal|default)\b/.test(normalized)) return 'balanced';
  if (/\b(contrarian|against the crowd|differentiated)\b/.test(normalized)) return 'contrarian';
  if (/\b(catch up|catch-up|catch_up|chasing)\b/.test(normalized)) return 'catch_up';
  if (/\b(protect (my |the )?lead|protect_lead|defend (my |the )?lead)\b/.test(normalized)) return 'protect_lead';
  if (/\b(final swing|final_swing|big swing)\b/.test(normalized)) return 'final_swing';
  return null;
}

function extractStakeUsd(raw: string): string | null {
  return (
    raw.match(/\$\s*(\d+(?:\.\d+)?)/)?.[1] ??
    raw.match(/\b(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\b/i)?.[1] ??
    null
  );
}

function extractStakePlanck(raw: string): string | null {
  return (
    raw.match(/\b(\d{10,})\s*planck\b/i)?.[1] ??
    raw.match(/\bplanck\s*(\d{10,})\b/i)?.[1] ??
    null
  );
}

function extractFundingSource(normalized: string): FundingSource | null {
  if (/\b(freebet|free bet|incentive)\b/.test(normalized)) return 'freebet';
  if (/\b(cash|vara|own funds)\b/.test(normalized)) return 'cash';
  return null;
}

function extractPublicWallet(raw: string): string | null {
  if (containsSecretLike(raw)) return null;
  return raw.match(walletPattern)?.[0].toLowerCase() ?? null;
}

function extractPolicyMode(normalized: string): TelegramNaturalLanguagePolicyMode | null {
  if (/\bread[ -_]?only\b/.test(normalized)) return 'read_only';
  if (/\bapproval[ -_]?required\b/.test(normalized)) return 'approval_required';
  if (/\bclaim[ -_]?only\b/.test(normalized)) return 'claim_only';
  if (/\b(tournament[ -_]?autopilot|autopilot)\b/.test(normalized)) return 'tournament_autopilot';
  return null;
}

function findAmbiguousSlots(
  raw: string,
  normalized: string,
  options: TelegramNaturalLanguageParserOptions,
): TelegramNaturalLanguageSlotName[] {
  const ambiguous = new Set<TelegramNaturalLanguageSlotName>();
  if (!isAlternativePickSetRequest(normalized) && countRiskMatches(normalized) > 1) ambiguous.add('riskMode');
  if (countPolicyMatches(normalized) > 1) ambiguous.add('policyMode');
  if (hasMixedPolicyAndRiskSignals(normalized)) {
    ambiguous.add('riskMode');
    ambiguous.add('policyMode');
  }
  if (isVagueRiskModeMutation(normalized)) ambiguous.add('riskMode');
  if (raw.match(walletPattern) && containsSecretLike(raw)) ambiguous.add('publicWallet');
  if (tournamentMatches(normalized, options).length > 1) ambiguous.add('tournamentId');
  return [...ambiguous];
}

function isAlternativePickSetRequest(normalized: string): boolean {
  return matches(normalized, [
    'alternative picks',
    'pick alternatives',
    'four picks',
    'four pick options',
    'safest pick',
    'safe pick',
    'balanced pick',
    'contrarian pick',
    'leaderboard upside',
    'leaderboard-upside',
    'safest balanced contrarian',
  ]);
}

function hasExplicitRiskModeLanguage(normalized: string): boolean {
  return /\b(risk|mode|objective)\b/.test(normalized);
}

function countProductMatches(normalized: string): number {
  return [
    /\b(single|one match|1 match|single match)\b/,
    /\b(bundle|five match|5 match|five game|5 game|next five)\b/,
    /\b(podium|champion|runner up|third place)\b/,
    /\b(tournament advisory|tournament report|rolling advisory)\b/,
  ].filter((pattern) => pattern.test(normalized)).length;
}

function countRiskMatches(normalized: string): number {
  return [
    /\b(conservative|safe|cautious)\b/,
    /\b(balanced|normal|default)\b/,
    /\b(contrarian|against the crowd|differentiated)\b/,
    /\b(catch up|catch-up|catch_up|chasing)\b/,
    /\b(protect (my |the )?lead|protect_lead|defend (my |the )?lead)\b/,
    /\b(final swing|final_swing|big swing)\b/,
  ].filter((pattern) => pattern.test(normalized)).length;
}

function countPolicyMatches(normalized: string): number {
  return [
    /\bread[ -_]?only\b/,
    /\bapproval[ -_]?required\b/,
    /\bclaim[ -_]?only\b/,
    /\b(tournament[ -_]?autopilot|autopilot)\b/,
  ].filter((pattern) => pattern.test(normalized)).length;
}

function hasMixedPolicyAndRiskSignals(normalized: string): boolean {
  return countRiskMatches(normalized) > 0 && countPolicyMatches(normalized) > 0;
}

function isVagueRiskModeMutation(normalized: string): boolean {
  if (countRiskMatches(normalized) !== 1 || countPolicyMatches(normalized) > 0) return false;
  if (/\b(risk|objective|strategy|posture|prediction)\b/.test(normalized)) return false;
  if (/\buse\s+(conservative|safe|cautious|balanced|normal|default|contrarian|against the crowd|differentiated|catch up|catch-up|catch_up|chasing|protect (?:my |the )?lead|protect_lead|defend (?:my |the )?lead|final swing|final_swing|big swing)\s+(mode|strategy)\b/.test(normalized)) return false;
  return (
    /\bmake\s+(?:it|the agent|mode)?\s*(?:to\s+)?/.test(normalized) ||
    /\b(?:set|change|switch)\s+(?:it|the agent|mode)\s*(?:to\s+)?/.test(normalized)
  );
}

function hasSlot(slots: TelegramNaturalLanguageSlots, slot: TelegramNaturalLanguageSlotName): boolean {
  if (slot === 'operatorOnly') return slots.operatorOnly !== undefined;
  if (slot === 'confidence') return slots.confidence !== undefined;
  return slots[slot] !== undefined && slots[slot] !== null && slots[slot] !== '';
}

function matches(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => normalized.includes(phrase));
}

function isExternalServiceLanguage(normalized: string): boolean {
  return matches(normalized, [
    'price',
    'cost',
    'how much',
    'buy',
    'order',
    'purchase',
    'service',
    'user',
    'client',
  ]);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s.$:#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsSecretLike(text: string): boolean {
  return /\b(mnemonic|seed phrase|private key|secret key|wallet json|keystore|browser session)\b/i.test(text);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
