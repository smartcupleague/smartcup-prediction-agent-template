import { createHash } from 'node:crypto';
import type {
  RiskMode,
  StoredTelegramPreference,
  StrategyPosture,
  TelegramPreferenceRole,
  TelegramPreferenceUpdateSource,
} from '../types/index.js';

export type TelegramPreferencePatch = Partial<
  Pick<StoredTelegramPreference, 'defaultRiskMode' | 'simulationObjective' | 'strategyPosture'>
>;

export type TelegramPreferenceInput = {
  telegramUserId: string | number;
  tournamentId: string;
  role: TelegramPreferenceRole;
  patch?: TelegramPreferencePatch;
  existing?: StoredTelegramPreference | null;
  updatedBy?: TelegramPreferenceUpdateSource;
  note?: string;
  payload?: Record<string, unknown>;
};

const defaultRiskMode: RiskMode = 'balanced';
const defaultSimulationObjective: RiskMode = 'balanced';
const defaultStrategyPosture: StrategyPosture = 'balanced';

export function telegramPreferenceSubjectId(telegramUserId: string | number): string {
  return `telegram:${String(telegramUserId).trim()}`;
}

export function buildTelegramPreference(input: TelegramPreferenceInput): StoredTelegramPreference {
  const now = new Date().toISOString();
  const subjectId = telegramPreferenceSubjectId(input.telegramUserId);
  const existing = input.existing ?? null;

  return {
    id: existing?.id ?? telegramPreferenceId(subjectId, input.tournamentId, input.role),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    transport: 'telegram',
    role: input.role,
    subjectId,
    subjectHash: hashPreferenceSubject(subjectId),
    tournamentId: input.tournamentId,
    defaultRiskMode: input.patch?.defaultRiskMode ?? existing?.defaultRiskMode ?? defaultRiskMode,
    simulationObjective: input.patch?.simulationObjective ?? existing?.simulationObjective ?? defaultSimulationObjective,
    strategyPosture: input.patch?.strategyPosture ?? existing?.strategyPosture ?? defaultStrategyPosture,
    updatedBy: input.updatedBy ?? 'system',
    notes: [...(existing?.notes ?? []), input.note].filter((note): note is string => Boolean(note)),
    payload: {
      ...(existing?.payload ?? {}),
      ...(input.payload ?? {}),
    },
  };
}

export function defaultTelegramPreference(input: {
  telegramUserId: string | number;
  tournamentId: string;
  role: TelegramPreferenceRole;
}): StoredTelegramPreference {
  return buildTelegramPreference({
    ...input,
    updatedBy: 'system',
    note: 'Default preference record generated without persisting.',
  });
}

export function renderTelegramPreferenceSummary(preference: StoredTelegramPreference): string {
  return [
    `Role: ${preference.role}`,
    `Tournament: ${preference.tournamentId}`,
    `Default risk: ${preference.defaultRiskMode}`,
    `Simulation objective: ${preference.simulationObjective}`,
    `Strategy posture: ${preference.strategyPosture}`,
    `Updated: ${preference.updatedAt}`,
  ].join('\n');
}

function telegramPreferenceId(subjectId: string, tournamentId: string, role: TelegramPreferenceRole): string {
  return `telegram-preference-${hashPreferenceSubject(`${subjectId}:${tournamentId}:${role}`).slice(2, 18)}`;
}

function hashPreferenceSubject(value: string): `0x${string}` {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}
