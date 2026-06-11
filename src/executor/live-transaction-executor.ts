import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentConfig, StoredTransactionPlan, StoredTransactionResult } from '../types/index.js';
import { varaWalletBin } from '../utils/vara-wallet-bin.js';
import { evaluateAutopilotReadiness } from './autopilot-readiness.js';

const execFileAsync = promisify(execFile);

export type LiveExecutionOptions = {
  explicitApproval: boolean;
};

export async function executeTransactionPlan(
  config: AgentConfig,
  plan: StoredTransactionPlan,
  options: LiveExecutionOptions,
): Promise<StoredTransactionResult> {
  const refusal = executionRefusal(config, plan, options);
  if (refusal) return refusal;

  const createdAt = new Date().toISOString();
  const command = buildExecutionCommand(plan);

  try {
    const { stdout, stderr } = await execFileAsync(command.command, command.args, {
      cwd: process.cwd(),
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = parseVaraWalletOutput(stdout);

    return {
      id: `txresult-${plan.id}-submitted-${createdAt.replace(/[:.]/g, '-')}`,
      planId: plan.id,
      createdAt,
      updatedAt: createdAt,
      status: 'submitted',
      txHash: pickString(parsed, ['txHash', 'transactionHash', 'hash']),
      messageId: pickString(parsed, ['messageId', 'message_id', 'id']),
      blockHash: pickString(parsed, ['blockHash', 'block_hash']),
      blockNumber: pickString(parsed, ['blockNumber', 'block_number']),
      error: null,
      chainReadback: null,
      payload: {
        stdout: parsed ?? stdout,
        stderr: stderr || null,
        command: redactCommand(command),
        executionMode: config.policy.mode,
        explicitApproval: options.explicitApproval,
      },
    };
  } catch (error) {
    const executionError = normalizeExecutionError(error);
    return {
      id: `txresult-${plan.id}-failed-${createdAt.replace(/[:.]/g, '-')}`,
      planId: plan.id,
      createdAt,
      updatedAt: createdAt,
      status: 'failed',
      txHash: null,
      messageId: null,
      blockHash: null,
      blockNumber: null,
      error: executionError.message,
      chainReadback: null,
      payload: {
        stdout: executionError.stdout,
        stderr: executionError.stderr,
        command: redactCommand(command),
        executionMode: config.policy.mode,
        explicitApproval: options.explicitApproval,
      },
    };
  }
}

function executionRefusal(
  config: AgentConfig,
  plan: StoredTransactionPlan,
  options: LiveExecutionOptions,
): StoredTransactionResult | null {
  const createdAt = new Date().toISOString();
  const failedChecks = plan.safetyChecks.filter((check) => check.status === 'fail');
  const notEvaluatedChecks = plan.safetyChecks.filter((check) => check.status === 'not_evaluated');
  const reasons: string[] = [];

  if (config.policy.mode === 'read_only') reasons.push('policy read_only blocks live execution');
  if (config.policy.mode === 'approval_required' && !options.explicitApproval) {
    reasons.push('approval_required mode needs explicit approval');
  }
  if (config.policy.mode === 'tournament_autopilot') {
    const readiness = evaluateAutopilotReadiness(config);
    if (!readiness.ready) {
      reasons.push(`tournament_autopilot readiness missing: ${readiness.missing.join(', ')}`);
    }
  }
  if (plan.status === 'blocked') reasons.push('transaction plan is blocked');
  if (failedChecks.length > 0) reasons.push(`failed safety checks: ${failedChecks.map((check) => check.name).join(', ')}`);
  if (notEvaluatedChecks.length > 0) {
    reasons.push(`not-evaluated safety checks remain: ${notEvaluatedChecks.map((check) => check.name).join(', ')}`);
  }

  if (reasons.length === 0) return null;

  return {
    id: `txresult-${plan.id}-execution-refused-${createdAt.replace(/[:.]/g, '-')}`,
    planId: plan.id,
    createdAt,
    updatedAt: createdAt,
    status: 'submission_blocked',
    txHash: null,
    messageId: null,
    blockHash: null,
    blockNumber: null,
    error: `Live execution refused: ${reasons.join('; ')}.`,
    chainReadback: null,
    payload: {
      executionMode: config.policy.mode,
      explicitApproval: options.explicitApproval,
      planStatus: plan.status,
      safetyChecks: plan.safetyChecks,
    },
  };
}

function buildExecutionCommand(plan: StoredTransactionPlan): { command: string; args: string[] } {
  const raw = plan.payload.command;
  if (!Array.isArray(raw) || raw.some((part) => typeof part !== 'string')) {
    throw new Error(`Transaction plan ${plan.id} does not contain an executable command array.`);
  }

  const commandParts = raw as string[];
  const walletBin = varaWalletBin();
  if (walletBin) {
    const varaIndex = commandParts.findIndex((part) => part === 'vara-wallet');
    if (varaIndex < 0) throw new Error('Stored command does not contain vara-wallet executable marker.');
    return {
      command: walletBin,
      args: commandParts.slice(varaIndex + 1),
    };
  }

  const [command, ...args] = commandParts;
  if (!command) throw new Error('Stored command is empty.');
  return { command, args };
}

function normalizeExecutionError(error: unknown): { message: string; stdout: string | null; stderr: string | null } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    message: error instanceof Error ? error.message : String(error),
    stdout: typeof record.stdout === 'string' && record.stdout.trim() ? record.stdout : null,
    stderr: typeof record.stderr === 'string' && record.stderr.trim() ? record.stderr : null,
  };
}

function parseVaraWalletOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last >= first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function pickString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  }
  const result = record.result;
  if (result && typeof result === 'object') return pickString(result, keys);
  return null;
}

function redactCommand(command: { command: string; args: string[] }): string[] {
  return [command.command, ...command.args];
}
