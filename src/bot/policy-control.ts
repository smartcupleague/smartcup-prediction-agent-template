import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryStore } from '../memory/memory-store.js';
import type {
  AgentConfig,
  ExecutionMode,
  RuntimePolicyUpdateSource,
  StoredRuntimePolicy,
} from '../types/index.js';
import { evaluateAutopilotReadiness } from '../executor/autopilot-readiness.js';

const ENV_KEY = 'SMARTPREDICTOR_POLICY_MODE';
const RUNTIME_POLICY_ID = 'runtime-policy:operator';

export type PolicySwitchResult = {
  previousMode: ExecutionMode;
  nextMode: ExecutionMode;
  envPath: string;
  persistedPolicyId: string;
  warning: string | null;
};

export type PolicySwitchOptions = {
  source?: RuntimePolicyUpdateSource;
  updatedBy?: string | number | null;
  persistEnv?: boolean;
  memory?: MemoryStore;
  note?: string;
};

export type StoredPolicyOverrideResult = {
  applied: boolean;
  policy: StoredRuntimePolicy | null;
};

export function applyStoredPolicyOverride(
  config: AgentConfig,
  memory = new MemoryStore(),
): StoredPolicyOverrideResult {
  const policy = memory.getRuntimePolicy(RUNTIME_POLICY_ID);
  if (!policy) return { applied: false, policy: null };
  config.policy.mode = policy.mode;
  process.env[ENV_KEY] = policy.mode;
  return { applied: true, policy };
}

export function switchPolicyMode(
  config: AgentConfig,
  mode: string,
  options: PolicySwitchOptions = {},
): PolicySwitchResult {
  const nextMode = parseExecutionMode(mode);
  const envPath = resolve('.env');
  const previousMode = config.policy.mode;
  const persistEnv = options.persistEnv ?? true;

  if (persistEnv) writePolicyEnv(envPath, nextMode);

  process.env[ENV_KEY] = nextMode;
  config.policy.mode = nextMode;

  const memory = options.memory ?? new MemoryStore();
  const existing = memory.getRuntimePolicy(RUNTIME_POLICY_ID);
  const now = new Date().toISOString();
  const policy: StoredRuntimePolicy = {
    id: RUNTIME_POLICY_ID,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    mode: nextMode,
    source: options.source ?? 'cli',
    updatedBy:
      options.updatedBy === null || options.updatedBy === undefined
        ? null
        : String(options.updatedBy).trim(),
    startupEnvMode: previousMode,
    notes: [
      ...(existing?.notes ?? []),
      options.note ??
        `Policy changed from ${previousMode} to ${nextMode}; env persistence ${persistEnv ? 'enabled' : 'disabled'}.`,
    ],
    payload: {
      ...(existing?.payload ?? {}),
      envPath,
      previousMode,
      persistedAt: now,
      persistEnv,
    },
  };
  memory.saveRuntimePolicy(policy);

  const readiness = evaluateAutopilotReadiness({
    ...config,
    policy: {
      ...config.policy,
      mode: nextMode,
    },
  });

  return {
    previousMode,
    nextMode,
    envPath,
    persistedPolicyId: policy.id,
    warning:
      nextMode === 'tournament_autopilot' && !readiness.ready
        ? `Autopilot selected, but it remains blocked until: ${readiness.missing.join(', ')}.`
        : null,
  };
}

export function renderPolicySummary(config: AgentConfig): string {
  const readiness = evaluateAutopilotReadiness(config);
  const storedPolicy = new MemoryStore().getRuntimePolicy(RUNTIME_POLICY_ID);
  return [
    `Current policy: ${config.policy.mode}`,
    storedPolicy
      ? `Persisted runtime policy: ${storedPolicy.mode} (${storedPolicy.source}, updated ${storedPolicy.updatedAt})`
      : 'Persisted runtime policy: none; using environment/default startup value',
    `Approval flow verified: ${config.policy.approvalFlowVerified}`,
    `Live smoke verified: ${config.policy.liveSmokeVerified}`,
    `Live smoke reference: ${config.policy.liveSmokeReference || 'not set'}`,
    `Autopilot ready: ${readiness.ready}`,
    readiness.ready ? null : `Autopilot missing: ${readiness.missing.join(', ')}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function writePolicyEnv(envPath: string, mode: ExecutionMode): void {
  const raw = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const nextLine = `${ENV_KEY}=${mode}`;
  const updated = raw.includes(`${ENV_KEY}=`)
    ? raw.replace(new RegExp(`^${ENV_KEY}=.*$`, 'm'), nextLine)
    : `${raw.trimEnd()}\n${nextLine}\n`;

  writeFileSync(envPath, updated.endsWith('\n') ? updated : `${updated}\n`);
}

function parseExecutionMode(value: string): ExecutionMode {
  const normalized = value.trim();
  if (
    normalized === 'read_only' ||
    normalized === 'approval_required' ||
    normalized === 'tournament_autopilot' ||
    normalized === 'claim_only'
  ) {
    return normalized;
  }
  throw new Error('Invalid policy mode. Use read_only, approval_required, tournament_autopilot, or claim_only.');
}
