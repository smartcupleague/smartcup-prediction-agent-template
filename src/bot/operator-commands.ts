import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { usdToPlanck } from '../economics/vara-usd-converter.js';
import { MemoryStore } from '../memory/memory-store.js';
import type { AgentConfig } from '../types/index.js';
import {
  renderFriendlyCompetitorAnalysis,
  type FriendlySimulationPayload,
} from './friendly-competitor-renderer.js';
import { renderFriendlyCrowdContrarianMap } from './friendly-crowd-renderer.js';
import { renderFriendlyFootballContextRisk } from './friendly-football-context-renderer.js';
import {
  renderFriendlyLiveExecutionResult,
  type FriendlyLiveExecutionPayload,
} from './friendly-live-execution-renderer.js';
import { renderFriendlyMarketComparison } from './friendly-market-renderer.js';
import { formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlyPredictionPreview } from './friendly-prediction-renderer.js';
import { renderFriendlySourceFallback } from './friendly-source-fallback-renderer.js';
import {
  renderFriendlyOperatorPolicyStatus,
  renderFriendlyOperatorPolicyUpdate,
} from './friendly-wallet-safety-renderer.js';
import { normalizeCommand, TelegramPermissionModel, type TelegramUserContext } from './permissions.js';
import { switchPolicyMode } from './policy-control.js';

const execFileAsync = promisify(execFile);

function adminSafetyLine(): string {
  return 'Safety: this is a personal, non-custodial SmartCup agent. It never needs your mnemonic, private key, seed phrase, browser session, or wallet JSON. You keep custody, verify each recommendation, and approve wallet actions explicitly.';
}

export type TelegramOperatorCommandName =
  | 'operator_decide'
  | 'operator_simulate'
  | 'operator_approve'
  | 'operator_policy';

export type TelegramOperatorCommandInput = {
  command: TelegramOperatorCommandName | `/${TelegramOperatorCommandName}`;
  text: string;
  user: TelegramUserContext;
  config: AgentConfig;
};

export type TelegramOperatorCommandResponse = {
  ok: boolean;
  text: string;
  decisionId?: string | null;
};

export async function handleTelegramOperatorCommand(
  input: TelegramOperatorCommandInput,
): Promise<TelegramOperatorCommandResponse> {
  const command = normalizeCommand(input.command) as TelegramOperatorCommandName;
  const permission = new TelegramPermissionModel(input.config).canRun(command, input.user);
  if (!permission.allowed) {
    return {
      ok: false,
      text: `Operator command denied.\nReason: ${permission.reason}`,
    };
  }

  try {
    const args = parseKeyValueArgs(input.text, command);
    if (command === 'operator_decide') return await handleOperatorDecide(input.config, args);
    if (command === 'operator_simulate') return await handleOperatorSimulate(input.config, args);
    if (command === 'operator_approve') return await handleOperatorApprove(args);
    return handleOperatorPolicy(input.config, args, input.user);
  } catch (error) {
    return {
      ok: false,
      text: renderOperatorError(command, error),
    };
  }
}

function renderOperatorError(command: TelegramOperatorCommandName, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (command === 'operator_decide' || command === 'operator_simulate') {
    return [
      renderFriendlySourceFallback({
        title:
          command === 'operator_decide'
            ? 'Prediction preview could not be generated'
            : 'Competitor simulation could not be generated',
        rawMessages: [message],
        impact: 'The agent could not complete this read-only analysis from the available sources.',
        fallbackAction: 'Rerun once after a short pause. If it repeats, check Data Provider Status and use a specific match id.',
      }),
      adminSafetyLine(),
    ].join('\n\n');
  }
  if (command === 'operator_approve') {
    return [
      'Approval could not continue.',
      'The saved decision or safety checks were not in a state that allows guarded execution.',
      '',
      'Next action',
      'Regenerate a fresh prediction preview, then approve only from the saved decision button or explicit operator approval command.',
      adminSafetyLine(),
    ].join('\n');
  }
  return [
    'Operator policy command could not be completed.',
    'Check the requested policy mode and try again.',
    adminSafetyLine(),
  ].join('\n');
}

async function handleOperatorSimulate(
  config: AgentConfig,
  args: Record<string, string>,
): Promise<TelegramOperatorCommandResponse> {
  const match = required(args, 'match');
  const objective = args.objective ?? args.risk ?? 'balanced';
  const funding = args.funding ?? 'cash';
  const stakeContext = await resolveTelegramOperatorStake(config, args);
  const stake = stakeContext.planck;
  const iterations = args.iterations ?? '2000';
  const profiles = args.profiles ?? '50';
  const candidates = args.candidates ?? '8';
  const topScores = args.topScores ?? '8';
  const seed = args.seed ?? 'smartcup-agent-telegram';

  const output = await runCli([
    'simulate',
    '--',
    '--match',
    match,
    '--objective',
    objective,
    '--funding',
    funding,
    '--stake',
    stake,
    '--iterations',
    iterations,
    '--profiles',
    profiles,
    '--candidates',
    candidates,
    '--topScores',
    topScores,
    '--seed',
    seed,
  ]);
  const parsed = extractJsonPayload<FriendlySimulationPayload>(output);
  return {
    ok: true,
    text: [
      renderFriendlyCompetitorAnalysis(parsed, {
        matchId: match,
        objective,
        iterations,
        profiles,
        stakeLabel: stakeContext.label,
        varaUsdPrice: stakeContext.price,
      }),
      adminSafetyLine(),
    ].join('\n\n'),
  };
}

function handleOperatorPolicy(
  config: AgentConfig,
  args: Record<string, string>,
  user: TelegramUserContext,
): TelegramOperatorCommandResponse {
  const mode = args.mode ?? args.set ?? args.policy;
  if (!mode) {
    return {
      ok: true,
      text: [renderFriendlyOperatorPolicyStatus(config), adminSafetyLine()].join('\n\n'),
    };
  }

  const result = switchPolicyMode(config, mode, {
    source: 'telegram_command',
    updatedBy: user.id,
    note: `Operator policy changed from Telegram by user ${user.id}.`,
  });
  return {
    ok: true,
    text: [renderFriendlyOperatorPolicyUpdate(config, result), adminSafetyLine()].join('\n\n'),
  };
}

async function handleOperatorDecide(
  config: AgentConfig,
  args: Record<string, string>,
): Promise<TelegramOperatorCommandResponse> {
  const match = required(args, 'match');
  const risk = args.risk ?? 'balanced';
  const funding = args.funding ?? 'cash';
  const stakeContext = await resolveTelegramOperatorStake(config, args);
  const stake = stakeContext.planck;
  const iterations = args.iterations ?? '500';
  const profiles = args.profiles ?? '25';
  const candidates = args.candidates ?? '8';
  const seed = args.seed ?? 'smartcup-agent-telegram';

  const output = await runCli([
    'decide',
    '--',
    '--match',
    match,
    '--risk',
    risk,
    '--funding',
    funding,
    '--stake',
    stake,
    '--iterations',
    iterations,
    '--profiles',
    profiles,
    '--candidates',
    candidates,
    '--seed',
    seed,
    '--save',
    'true',
    '--format',
    'summary',
  ]);
  const decisionId = extractDecisionId(output);
  const decision = decisionId ? new MemoryStore().getDecision(decisionId) : null;
  let friendlyPreview: string | null = null;
  if (decision) {
    if (args.focus === 'market' || args.market === 'true') friendlyPreview = renderFriendlyMarketComparison(decision);
    else if (args.focus === 'context' || args.context === 'true') {
      friendlyPreview = renderFriendlyFootballContextRisk(decision);
    } else if (args.focus === 'crowd' || args.crowd === 'true') {
      friendlyPreview = renderFriendlyCrowdContrarianMap(decision);
    } else {
      friendlyPreview = renderFriendlyPredictionPreview(decision);
    }
  }

  return {
    ok: Boolean(decisionId),
    decisionId,
    text: friendlyPreview
      ? [friendlyPreview, adminSafetyLine()].join('\n\n')
      : [
          'Prediction preview',
          'Preview only. No transaction was submitted.',
          '',
          `Stake context: ${stakeContext.label}.`,
          '',
          decisionId
            ? `Saved report id: ${decisionId}`
            : 'Saved report id: not found.',
          '',
          'What happened',
          decisionId
            ? 'The model run finished and saved a report id, but Telegram could not load the friendly report body from local memory.'
            : 'The model run finished, but Telegram could not prove a saved DecisionReport id.',
          '',
          'Next action',
          decisionId
            ? 'Open Saved Decisions or rerun the preview before approval.'
            : 'Rerun the prediction preview. Approval stays blocked until the bot shows a saved report id.',
          decisionId ? 'Execution still requires the Approve Plan button or explicit /operator_approve command.' : null,
          adminSafetyLine(),
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
  };
}

async function resolveTelegramOperatorStake(
  config: AgentConfig,
  args: Record<string, string>,
): Promise<{
  planck: string;
  label: string;
  price: Awaited<ReturnType<typeof usdToPlanck>>['price'] | null;
}> {
  const rawStakeOverride = args.stake ?? args.stakePlanck;
  if (rawStakeOverride) {
    const planck = rawStakeOverride;
    return {
      planck,
      label: `${formatFriendlyPlanckAmount(planck, null)} raw stake override`,
      price: null,
    };
  }

  const stakeUsd = args.stakeUsd ?? config.policy.minStakeUsd ?? '3';
  try {
    const conversion = await usdToPlanck(config, stakeUsd);
    return {
      planck: conversion.planck,
      label: `USD ${stakeUsd} converted to ${formatFriendlyPlanckAmount(conversion.planck, conversion.price)}`,
      price: conversion.price,
    };
  } catch {
    const fallback = '4500000000000000';
    return {
      planck: fallback,
      label: `${formatFriendlyPlanckAmount(fallback, null)} fallback because USD/VARA conversion was unavailable`,
      price: null,
    };
  }
}

async function handleOperatorApprove(args: Record<string, string>): Promise<TelegramOperatorCommandResponse> {
  const decision = required(args, 'decision');
  const kind = args.kind ?? 'PlaceBet';
  const valuePlanck = args.valuePlanck ?? args['value-planck'];
  const output = await runCli([
    'submit',
    '--',
    '--decision',
    decision,
    '--kind',
    kind,
    ...(valuePlanck ? ['--value-planck', valuePlanck] : []),
    '--execute',
    'true',
    '--confirm-execute',
    'true',
  ]);
  const parsed = extractJsonPayload<FriendlyLiveExecutionPayload>(output);

  return {
    ok: true,
    decisionId: decision,
    text: [
      parsed
        ? renderFriendlyLiveExecutionResult(parsed, { decisionId: decision })
        : renderFriendlySourceFallback({
            title: 'Approval result could not be summarized',
            rawMessages: [output],
            impact: 'The approval command completed, but the agent could not parse the transaction audit payload.',
            fallbackAction: 'Check local transaction history before retrying. Do not approve the same decision again until read-back is clear.',
          }),
      adminSafetyLine(),
    ].join('\n\n'),
  };
}

function parseKeyValueArgs(text: string, command: string): Record<string, string> {
  const args: Record<string, string> = {};
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const body = normalizeCommand(tokens[0] ?? '') === command ? tokens.slice(1) : tokens;
  for (const token of body) {
    const separator = token.includes(':') ? token.indexOf(':') : token.indexOf('=');
    if (separator <= 0) continue;
    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1).trim();
    if (key && value) args[key] = value;
  }
  return args;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`Missing required argument: ${key}`);
  return value;
}

async function runCli(args: string[]): Promise<string> {
  const [command, separator, ...rest] = args;
  if (!command) throw new Error('Internal CLI command is missing.');
  const cliArgs = separator === '--' ? [command, ...rest] : args;
  const compiledCli = 'dist/cli.js';
  const executable = existsSync(compiledCli) ? process.execPath : 'npm';
  const executableArgs = existsSync(compiledCli) ? [compiledCli, ...cliArgs] : ['run', ...args];
  const { stdout, stderr } = await execFileAsync(executable, executableArgs, {
    cwd: process.cwd(),
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return [stdout, stderr].filter(Boolean).join('\n');
}

function extractDecisionId(output: string): string | null {
  const match = output.match(/Saved decision report:\s*(\S+)/);
  return match?.[1] ?? null;
}

function extractJsonPayload<T>(output: string): T | null {
  const first = output.indexOf('{');
  const last = output.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(output.slice(first, last + 1)) as T;
  } catch {
    return null;
  }
}
