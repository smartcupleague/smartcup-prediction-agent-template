import {
  getTelegramNaturalLanguageIntentDefinition,
  getTelegramNaturalLanguageSlotDefinition,
  type TelegramNaturalLanguageParsedIntent,
  type TelegramNaturalLanguageSlotName,
} from './natural-language-intents.js';

export type TelegramNaturalLanguageClarificationReport = {
  requiresClarification: boolean;
  blockingPrompts: string[];
  advisoryPrompts: string[];
  primaryPrompt: string | null;
};

const recommendedSlotsByIntent: Partial<
  Record<TelegramNaturalLanguageParsedIntent['intent'], TelegramNaturalLanguageSlotName[]>
> = {
  agent_status: ['tournamentId'],
  eligible_matches: ['tournamentId', 'matchScope'],
  leaderboard_analysis: ['tournamentId', 'stakeUsd', 'fundingSource'],
  market_analysis: ['tournamentId', 'stakeUsd', 'fundingSource'],
  timing_strategy: ['tournamentId', 'stakeUsd', 'fundingSource'],
  crowd_contrarian_map: ['tournamentId', 'stakeUsd', 'fundingSource'],
  football_context_risk: ['tournamentId', 'stakeUsd', 'fundingSource'],
  tournament_position_strategy: ['tournamentId', 'stakeUsd', 'fundingSource'],
  alternative_pick_set: ['tournamentId', 'stakeUsd', 'fundingSource'],
  decision_preview: ['tournamentId', 'stakeUsd', 'fundingSource'],
  freebet_status: ['publicWallet'],
  refund_status: ['publicWallet'],
};

export function buildTelegramNaturalLanguageClarification(
  parsed: TelegramNaturalLanguageParsedIntent,
): TelegramNaturalLanguageClarificationReport {
  const definition = getTelegramNaturalLanguageIntentDefinition(parsed.intent);
  const blockingPrompts = [
    ...parsed.missingRequiredSlots.map((slot) => missingSlotPrompt(parsed, slot)),
    ...parsed.ambiguousSlots.map((slot) => ambiguousSlotPrompt(parsed, slot)),
  ];
  const advisoryPrompts = (recommendedSlotsByIntent[parsed.intent] ?? [])
    .filter((slot) => !hasSlot(parsed, slot))
    .filter((slot) => !parsed.missingRequiredSlots.includes(slot))
    .filter((slot) => !parsed.ambiguousSlots.includes(slot))
    .map((slot) => recommendedSlotPrompt(parsed, slot));

  return {
    requiresClarification: blockingPrompts.length > 0,
    blockingPrompts,
    advisoryPrompts,
    primaryPrompt:
      blockingPrompts[0] ??
      advisoryPrompts[0] ??
      (parsed.intent === 'unknown' ? definition.clarification : null),
  };
}

function missingSlotPrompt(
  parsed: TelegramNaturalLanguageParsedIntent,
  slot: TelegramNaturalLanguageSlotName,
): string {
  if (slot === 'tournamentId') {
    return 'Which SmartCup tournament should I use? Example: World Cup 2026.';
  }
  if (slot === 'matchId') {
    return 'Which SmartCup match should I use? Example: match 4. For later routing, you can also ask for the next open match.';
  }
  if (slot === 'stakeUsd' || slot === 'stakePlanck') {
    return 'What stake should I use? Prefer USD, for example: $3.25.';
  }
  if (slot === 'fundingSource') {
    return 'Should I treat this as cash or freebet-funded?';
  }
  if (slot === 'publicWallet') {
    return 'Send only the public 0x wallet address. Never send a mnemonic, seed phrase, private key, or wallet JSON.';
  }
  if (slot === 'decisionId') {
    return 'Which saved decision id should I approve? Example: decision-3-balanced-2-1-1780502534986.';
  }
  if (slot === 'policyMode') {
    return 'Which policy mode should I use: read_only, approval_required, claim_only, or tournament_autopilot?';
  }

  return getTelegramNaturalLanguageSlotDefinition(slot).validation.rejectionMessage;
}

function ambiguousSlotPrompt(
  parsed: TelegramNaturalLanguageParsedIntent,
  slot: TelegramNaturalLanguageSlotName,
): string {
  if (slot === 'tournamentId') {
    return 'I found more than one possible tournament. Please name one tournament exactly.';
  }
  if (slot === 'matchId') {
    return 'I found more than one possible match reference. Please send one match id.';
  }
  if (slot === 'riskMode') {
    return 'I found an unclear risk or mode phrase. Say prediction risk, objective, strategy, or execution policy explicitly. Example: set risk to conservative, or set policy read only.';
  }
  if (slot === 'stakeUsd' || slot === 'stakePlanck') {
    return 'I found more than one stake. Please send one stake amount, preferably in USD.';
  }
  if (slot === 'fundingSource') {
    return 'I found both cash/freebet signals. Choose one funding source: cash or freebet.';
  }
  if (slot === 'publicWallet') {
    return 'I could not safely use that wallet text. Send only a public 0x wallet address.';
  }
  if (slot === 'policyMode') {
    return 'I found an unclear execution-policy phrase. Say one policy mode only: read_only, approval_required, claim_only, or tournament_autopilot.';
  }

  return `Please clarify ${getTelegramNaturalLanguageSlotDefinition(slot).label}.`;
}

function recommendedSlotPrompt(
  parsed: TelegramNaturalLanguageParsedIntent,
  slot: TelegramNaturalLanguageSlotName,
): string {
  if (slot === 'tournamentId') {
    return 'Tournament was not specified; I will use the active configured tournament unless you choose another one.';
  }
  if (slot === 'matchScope') {
    return 'Match scope was not specified; say “next open match” or “next five open matches” if that is what you mean.';
  }
  if (slot === 'stakeUsd') {
    return 'Stake was not specified; operator previews can default to the configured minimum, but you can say $3.25.';
  }
  if (slot === 'fundingSource') {
    return 'Funding source was not specified; cash is the default unless you say freebet.';
  }
  if (slot === 'publicWallet') {
    return 'Wallet was not specified; I can use the configured agent wallet for operator checks, or you can send a public 0x wallet.';
  }

  return `${getTelegramNaturalLanguageSlotDefinition(slot).label} was not specified.`;
}

function hasSlot(
  parsed: TelegramNaturalLanguageParsedIntent,
  slot: TelegramNaturalLanguageSlotName,
): boolean {
  if (slot === 'operatorOnly') return parsed.slots.operatorOnly !== undefined;
  if (slot === 'confidence') return parsed.slots.confidence !== undefined;
  const value = parsed.slots[slot];
  return value !== undefined && value !== null && value !== '';
}
