import { buildEligibleMatchPlanForWallet } from '../adapters/eligible-match-plan.js';
import type { TournamentProfileOption } from '../tournament/index.js';
import type { AgentConfig, MatchEligibilityView } from '../types/index.js';

export type EligibleMatchPickerResult = {
  tournament: TournamentProfileOption;
  matches: MatchEligibilityView[];
  totalEligible: number;
  generatedAt: string;
  warnings: string[];
};

export async function buildEligibleMatchPicker(
  config: AgentConfig,
  tournament: TournamentProfileOption,
  limit = 10,
): Promise<EligibleMatchPickerResult> {
  const report = await buildEligibleMatchPlanForWallet({
    config,
    tournamentProfilePath: tournament.path,
  });

  return {
    tournament,
    matches: report.plan.eligibleMatches.slice(0, limit),
    totalEligible: report.plan.eligibleMatches.length,
    generatedAt: report.plan.generatedAt,
    warnings: report.warnings,
  };
}

export function renderEligibleMatchLabel(match: MatchEligibilityView): string {
  return `#${match.matchId} ${match.home} vs ${match.away}`;
}

export function renderEligibleMatchLine(match: MatchEligibilityView): string {
  return [
    renderEligibleMatchLabel(match),
    `${match.phase}${match.phaseWeight ? ` x${match.phaseWeight}` : ''}`,
    `kickoff ${new Date(match.kickOffMs).toISOString()}`,
  ].join(' | ');
}
