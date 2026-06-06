export type SourceFallbackKind =
  | 'chain'
  | 'indexer'
  | 'smartcup_api'
  | 'sports_data'
  | 'odds'
  | 'football_context'
  | 'unknown';

export type SourceFallbackOptions = {
  title: string;
  rawMessages?: string[];
  fallbackAction: string;
  impact?: string;
  nextRetry?: string | null;
};

type SourceFallbackDescriptor = {
  kind: SourceFallbackKind;
  label: string;
  impact: string;
  nextAction: string;
};

export function renderFriendlySourceFallback(options: SourceFallbackOptions): string {
  const descriptors = summarizeSourceIssues(options.rawMessages ?? []);
  const primary = descriptors[0] ?? descriptorForKind('unknown');

  return [
    options.title,
    '',
    options.impact ?? primary.impact,
    '',
    'What is unavailable:',
    ...descriptors.map((descriptor) => `- ${descriptor.label}: ${descriptor.impact}`),
    descriptors.length === 0 ? '- Source read: unavailable, but the exact source could not be classified.' : null,
    '',
    'What the agent will do:',
    `- ${options.fallbackAction}`,
    `- ${primary.nextAction}`,
    options.nextRetry ? `- Suggested retry: ${options.nextRetry}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function renderFriendlySourceWarningBullets(rawMessages: string[], limit = 5): string[] {
  const descriptors = summarizeSourceIssues(rawMessages);
  if (descriptors.length === 0) return [];
  return descriptors.slice(0, limit).map((descriptor) => `${descriptor.label}: ${descriptor.impact}`);
}

export function summarizeSourceIssues(rawMessages: string[]): SourceFallbackDescriptor[] {
  const kinds = new Set<SourceFallbackKind>();
  for (const message of rawMessages) {
    kinds.add(classifySourceMessage(message));
  }
  return [...kinds].map(descriptorForKind);
}

export function classifySourceMessage(message: string): SourceFallbackKind {
  const text = message.toLowerCase();
  if (
    /\b(querystate|querymatch|querybetsbyuser|queryuserpoints|vara-wallet|bolao|chain|rpc|sigterm|transport|operation was aborted)\b/.test(
      text,
    )
  ) {
    return 'chain';
  }
  if (/\b(indexer|graphql|prepared statement|postgraphile|user stats|bets unavailable|hosted indexer)\b/.test(text)) {
    return 'indexer';
  }
  if (/\b(smartcup api|leaderboard api|profile api|pool distribution|profile was not found)\b/.test(text)) {
    return 'smartcup_api';
  }
  if (/\b(football-data|fixture provider|fixtures|results provider|sports-data|sports data)\b/.test(text)) {
    return 'sports_data';
  }
  if (/\b(odds|market|bookmaker|implied probability)\b/.test(text)) {
    return 'odds';
  }
  if (/\b(lineup|injury|suspension|availability|news|football context)\b/.test(text)) {
    return 'football_context';
  }
  return 'unknown';
}

function descriptorForKind(kind: SourceFallbackKind): SourceFallbackDescriptor {
  if (kind === 'chain') {
    return {
      kind,
      label: 'Vara chain / BolaoCore reads',
      impact: 'live contract state may be incomplete, so duplicate, cutoff, match, and points checks should be refreshed before approval.',
      nextAction: 'Rerun after a short pause or verify through the SmartCup UI before approving anything.',
    };
  }
  if (kind === 'indexer') {
    return {
      kind,
      label: 'Indexer / historical GraphQL reads',
      impact: 'opponent history, prior bets, crowd signals, and leaderboard simulation may be partial.',
      nextAction: 'Use the result as directional only; rerun once the indexer is healthy if competitor strategy matters.',
    };
  }
  if (kind === 'smartcup_api') {
    return {
      kind,
      label: 'SmartCup API reads',
      impact: 'profile, leaderboard enrichment, or pool-distribution context may be incomplete.',
      nextAction: 'Refresh the status or compare with the SmartCup website before acting on rank or profile data.',
    };
  }
  if (kind === 'sports_data') {
    return {
      kind,
      label: 'Sports fixtures/results provider',
      impact: 'fixtures, results, team context, or kickoff data may be stale or missing.',
      nextAction: 'Refresh provider configuration or verify fixture details manually before using timing-sensitive recommendations.',
    };
  }
  if (kind === 'odds') {
    return {
      kind,
      label: 'Odds / market provider',
      impact: 'bookmaker-implied probability comparison is missing or partial; prediction probabilities still come from the model.',
      nextAction: 'Add a manual odds snapshot or rerun without treating market edge as a decision driver.',
    };
  }
  if (kind === 'football_context') {
    return {
      kind,
      label: 'Lineup, injury, suspension, and news context',
      impact: 'late football context is missing or uncertain, so confidence should stay cautious.',
      nextAction: 'Refresh closer to kickoff or add a manual context JSON before approving high-stakes picks.',
    };
  }
  return {
    kind,
    label: 'Source read',
    impact: 'one supporting source could not be read cleanly.',
    nextAction: 'Rerun the command once; if the issue repeats, rely on saved reports and manual verification.',
  };
}
