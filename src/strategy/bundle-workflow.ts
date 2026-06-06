import { ANALYSIS_BUNDLE_TARGET_MATCH_COUNT } from '../products/index.js';
import type { AgentConfig, DecisionReport } from '../types/index.js';
import { buildDecisionForMatch, type DecisionWorkflowOptions } from './decision-workflow.js';

export type BundleDecisionWorkflowOptions = DecisionWorkflowOptions & {
  seedPrefix: string;
};

export type BundleDecisionWorkflowReport = {
  matchIds: string[];
  decisions: DecisionReport[];
  targetMatchCount: number;
};

export async function buildBundleDecisions(
  config: AgentConfig,
  matchIds: string[],
  options: BundleDecisionWorkflowOptions,
): Promise<BundleDecisionWorkflowReport> {
  if (matchIds.length !== ANALYSIS_BUNDLE_TARGET_MATCH_COUNT) {
    throw new Error(
      `5-match bundle requires exactly ${ANALYSIS_BUNDLE_TARGET_MATCH_COUNT} match ids. Found ${matchIds.length}.`,
    );
  }

  const decisions: DecisionReport[] = [];
  for (const matchId of matchIds) {
    decisions.push(
      await buildDecisionForMatch(config, matchId, {
        ...options,
        seed: `${options.seedPrefix}-${matchId}`,
      }),
    );
  }

  return {
    matchIds,
    decisions,
    targetMatchCount: ANALYSIS_BUNDLE_TARGET_MATCH_COUNT,
  };
}
