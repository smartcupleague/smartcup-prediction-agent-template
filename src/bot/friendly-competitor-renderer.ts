import type { VaraUsdPriceSource } from '../economics/vara-usd-converter.js';
import type { OpponentAwareOutputReport, PoolOutcome, RiskModeEvaluationReport, Score } from '../types/index.js';
import { formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export type FriendlySimulationPayload = {
  opponentAware?: OpponentAwareOutputReport;
  risk?: RiskModeEvaluationReport;
  opponents?: {
    sources: {
      chain: { available: boolean; userPointsCount: number; matchCount: number };
      smartcupApi: { available: boolean; leaderboardRows: number };
      indexer: { available: boolean; betCount: number; userStatCount: number };
    };
    profiles: Array<{
      wallet: string;
      displayName: string | null;
      archetype: string;
      archetypeConfidence: number;
      participationRate: number;
      predictionsObserved: number;
      currentPoints: number;
      pressureMode: string;
      sampleQuality: string;
      topPickedScores: Array<{ score: Score; count: number; rate: number }>;
    }>;
  };
  opponentSamples?: {
    totalOpponents: number;
    expectedParticipants: number;
    likelyParticipants: Array<{
      wallet: string;
      displayName: string | null;
      archetype: string;
      participationProbability: number;
      selectedScore: Score | null;
      selectedOutcome: PoolOutcome | null;
      rankPressureMode: string;
      distributionTop: Array<{
        score: Score;
        outcome: PoolOutcome;
        probability: number;
        crowdShare: number;
      }>;
    }>;
  };
  sourceWarnings?: string[];
};

export type FriendlyCompetitorRenderOptions = {
  matchId: string;
  objective: string;
  iterations: string;
  profiles: string;
  stakeLabel: string;
  varaUsdPrice?: VaraUsdPriceSource | null;
};

export function renderFriendlyCompetitorAnalysis(
  parsed: FriendlySimulationPayload | null,
  options: FriendlyCompetitorRenderOptions,
): string {
  if (!parsed?.opponentAware && !parsed?.risk) {
    return [
      'Competitor and leaderboard analysis',
      'Read-only simulation. No report was saved and no transaction was submitted.',
      '',
      `Match #${options.matchId}`,
      `Objective: ${formatMode(options.objective)}`,
      '',
      'The simulation ran, but the result could not be summarized into a clean Telegram briefing.',
      'Next action: rerun the analysis once, or check the local JSON/terminal output for the raw audit details.',
    ].join('\n');
  }

  const selected = parsed.risk?.selected ?? null;
  const bestByEquity = parsed.opponentAware?.bestByEquity ?? null;
  const bestByTopFive = parsed.opponentAware?.bestByTopFive ?? null;
  const outputs = parsed.opponentAware?.outputs ?? [];
  const top = outputs.slice(0, 5);
  const warnings = friendlyWarnings(parsed.sourceWarnings ?? []);

  return [
    'Competitor and leaderboard analysis',
    'Read-only simulation. No report was saved and no transaction was submitted.',
    '',
    `Match #${options.matchId}`,
    `Objective: ${formatMode(options.objective)}`,
    `Simulation size: ${options.iterations} runs, up to ${options.profiles} opponent profiles.`,
    `Stake context: ${options.stakeLabel}`,
    '',
    'Main read',
    selected
      ? `- Utility pick: ${formatScore(selected.score)} ${formatOutcome(selected.outcome)}. This is the best all-around score for the selected objective.`
      : '- Utility pick: unavailable.',
    bestByEquity
      ? `- Leaderboard-equity pick: ${formatScore(bestByEquity.score)} ${formatOutcome(bestByEquity.outcome)} with about ${formatVaraDelta(bestByEquity.finalPrize.equityDeltaPlanck, options.varaUsdPrice)} simulated final-prize equity change.`
      : '- Leaderboard-equity pick: unavailable.',
    bestByTopFive
      ? `- Rank-safety pick: ${formatScore(bestByTopFive.score)} ${formatOutcome(bestByTopFive.outcome)} with ${formatPercent(bestByTopFive.probabilities.top5)} simulated top-five probability.`
      : '- Rank-safety pick: unavailable.',
    ...strategyNotes(parsed),
    '',
    'Top candidate comparison',
    ...renderTopCandidates(top, options.varaUsdPrice),
    '',
    'Competitor picture',
    ...renderCompetitorPicture(parsed),
    '',
    'Likely opponent behavior',
    ...renderOpponentBehavior(parsed),
    '',
    'Data quality',
    ...renderSourceCoverage(parsed),
    ...warnings.map((warning) => `- ${warning}`),
    '',
    'Next action',
    nextAction(parsed),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function strategyNotes(parsed: FriendlySimulationPayload): string[] {
  const selected = parsed.risk?.selected ?? null;
  const bestByEquity = parsed.opponentAware?.bestByEquity ?? null;
  const outputs = parsed.opponentAware?.outputs ?? [];
  const saturatedTopFive = outputs.length > 0 && outputs.every((candidate) => candidate.probabilities.top5 >= 0.999);
  const blockers = uniqueBlockers(outputs).slice(0, 3);
  const notes: string[] = [];

  if (selected && bestByEquity && scoreKey(selected.score) !== scoreKey(bestByEquity.score)) {
    notes.push(
      `- Strategy tension: ${formatScore(selected.score)} is the balanced utility choice, while ${formatScore(bestByEquity.score)} has stronger leaderboard-equity upside.`,
    );
  } else if (selected && bestByEquity) {
    notes.push('- Strategy alignment: utility and leaderboard equity are pointing to the same score family.');
  }

  if (saturatedTopFive) {
    notes.push('- Top-five probability is saturated in this small leaderboard, so expected rank, equity delta, and blocker wallets are more useful than top-five alone.');
  }

  if (blockers.length > 0) {
    notes.push(`- Main blocker wallet signal: ${blockers.map(shortWallet).join(', ')} can tie or stay ahead against several candidate scores.`);
  }

  return notes;
}

function renderTopCandidates(
  candidates: NonNullable<OpponentAwareOutputReport['outputs']>,
  price: VaraUsdPriceSource | null | undefined,
): string[] {
  if (candidates.length === 0) return ['- No candidate table was available.'];
  return candidates.map((candidate, index) => {
    const blockerText =
      candidate.blockerWallets.length > 0
        ? `; blockers: ${candidate.blockerWallets.slice(0, 2).map((entry) => shortWallet(String(entry.wallet))).join(', ')}`
        : '; blockers: none';
    return [
      `- ${index + 1}. ${formatScore(candidate.score)} ${formatOutcome(candidate.outcome)}`,
      `top-five ${formatPercent(candidate.probabilities.top5)}`,
      `expected rank ${formatRank(candidate.rank.expected)}`,
      `equity ${formatVaraDelta(candidate.finalPrize.equityDeltaPlanck, price)}`,
    ].join('; ') + blockerText;
  });
}

function renderCompetitorPicture(parsed: FriendlySimulationPayload): string[] {
  const profiles = parsed.opponents?.profiles ?? [];
  if (profiles.length === 0) return ['- No competitor profiles were available from the current reads.'];

  return profiles.slice(0, 5).map((profile, index) => {
    const name = profile.displayName ?? shortWallet(profile.wallet);
    const tendency =
      profile.topPickedScores.length > 0
        ? profile.topPickedScores
            .slice(0, 2)
            .map((pick) => `${formatScore(pick.score)} (${formatPercent(pick.rate)})`)
            .join(', ')
        : 'not enough score history yet';
    return `- ${index + 1}. ${name}: ${formatMode(profile.archetype)} profile, ${profile.predictionsObserved} observed predictions, ${profile.sampleQuality} data quality, common picks ${tendency}.`;
  });
}

function renderOpponentBehavior(parsed: FriendlySimulationPayload): string[] {
  const samples = parsed.opponentSamples?.likelyParticipants ?? [];
  if (samples.length === 0) {
    return ['- No opponents were sampled as likely participants under this seed. Treat blocker signals as low-confidence.'];
  }
  return samples.slice(0, 5).map((sample, index) => {
    const name = sample.displayName ?? shortWallet(sample.wallet);
    const selected = sample.selectedScore
      ? `${formatScore(sample.selectedScore)} ${formatOutcome(sample.selectedOutcome)}`
      : 'no sampled pick';
    const likelyScores =
      sample.distributionTop.length > 0
        ? sample.distributionTop
            .slice(0, 3)
            .map((entry) => `${formatScore(entry.score)} ${formatPercent(entry.probability)}`)
            .join(', ')
        : 'no likely-score distribution';
    return `- ${index + 1}. ${name}: participation ${formatPercent(sample.participationProbability)}, sampled ${selected}, likely scores ${likelyScores}.`;
  });
}

function renderSourceCoverage(parsed: FriendlySimulationPayload): string[] {
  const sources = parsed.opponents?.sources;
  const samples = parsed.opponentSamples;
  const lines: string[] = [];

  if (sources) {
    lines.push(
      `- Competitor reads: ${sources.smartcupApi.leaderboardRows} SmartCup leaderboard rows, ${sources.indexer.betCount} indexer bet rows, ${sources.indexer.userStatCount} indexer user-stat rows, ${sources.chain.userPointsCount} chain points rows.`,
    );
  } else {
    lines.push('- Competitor reads: unavailable.');
  }

  if (samples) {
    lines.push(
      `- Modeled opponents: ${samples.totalOpponents}. Expected participants for this match: ${formatNumber(samples.expectedParticipants)}. This is a probability-weighted estimate, not a real count.`,
    );
  }

  return lines;
}

function friendlyWarnings(warnings: string[]): string[] {
  const categories = new Set<string>(renderFriendlySourceWarningBullets(warnings, 5));
  for (const warning of warnings) {
    const text = warning.toLowerCase();
    if (text.includes('user_points') || text.includes('chain')) {
      categories.add('Chain points data is limited; rank gap estimates may be provisional.');
    }
  }
  if (categories.size === 0) categories.add('No major source warnings were detected in this simulation.');
  return [...categories].slice(0, 5);
}

function nextAction(parsed: FriendlySimulationPayload): string {
  const selected = parsed.risk?.selected ?? null;
  const bestByEquity = parsed.opponentAware?.bestByEquity ?? null;
  if (selected && bestByEquity && scoreKey(selected.score) !== scoreKey(bestByEquity.score)) {
    return `Compare ${formatScore(selected.score)} against ${formatScore(bestByEquity.score)} before approving a prediction. Use the prediction preview for wallet execution; this competitor analysis is read-only.`;
  }
  if (selected) {
    return `Use ${formatScore(selected.score)} as the current leaderboard-aware reference, then run a prediction preview before any approval.`;
  }
  return 'Run a prediction preview before any approval; this competitor analysis is read-only.';
}

function uniqueBlockers(outputs: NonNullable<OpponentAwareOutputReport['outputs']>): string[] {
  const wallets = new Set<string>();
  for (const output of outputs) {
    for (const blocker of output.blockerWallets) wallets.add(String(blocker.wallet));
  }
  return [...wallets];
}

function formatScore(score: Score): string {
  return `${score.home}-${score.away}`;
}

function formatOutcome(outcome: PoolOutcome | null): string {
  if (outcome === 'home') return 'home win';
  if (outcome === 'away') return 'away win';
  if (outcome === 'draw') return 'draw';
  return '';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function formatRank(value: number): string {
  return Number.isFinite(value) ? `#${value.toFixed(2)}` : 'n/a';
}

function formatVaraDelta(value: string, price: VaraUsdPriceSource | null | undefined): string {
  return formatFriendlyPlanckAmount(value, price);
}

function formatMode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function scoreKey(score: Score): string {
  return `${score.home}-${score.away}`;
}

function shortWallet(wallet: string): string {
  return wallet.length <= 14 ? wallet : `${wallet.slice(0, 8)}...${wallet.slice(-6)}`;
}
