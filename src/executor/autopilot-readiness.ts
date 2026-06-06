import type { AgentConfig } from '../types/index.js';

export type AutopilotReadiness = {
  ready: boolean;
  missing: string[];
  details: Record<string, unknown>;
};

export function evaluateAutopilotReadiness(config: AgentConfig): AutopilotReadiness {
  const missing: string[] = [];

  if (!config.policy.approvalFlowVerified) {
    missing.push('SMARTPREDICTOR_APPROVAL_FLOW_VERIFIED=true');
  }
  if (!config.policy.liveSmokeVerified) {
    missing.push('SMARTPREDICTOR_LIVE_SMOKE_VERIFIED=true');
  }
  if (!config.policy.liveSmokeReference) {
    missing.push('SMARTPREDICTOR_LIVE_SMOKE_REFERENCE=<audit-or-transaction-reference>');
  }

  return {
    ready: missing.length === 0,
    missing,
    details: {
      approvalFlowVerified: config.policy.approvalFlowVerified,
      liveSmokeVerified: config.policy.liveSmokeVerified,
      liveSmokeReference: config.policy.liveSmokeReference,
    },
  };
}
