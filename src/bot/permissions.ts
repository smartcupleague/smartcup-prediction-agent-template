import type { AgentConfig } from '../types/index.js';

export type TelegramUserContext = {
  id: string | number;
  username?: string | null;
  firstName?: string | null;
};

export type TelegramRole = 'admin' | 'user';

export type TelegramPermissionDecision = {
  allowed: boolean;
  role: TelegramRole;
  reason: string;
  userId: string;
};

export const userCommands = [
  'start',
  'menu',
  'agent_status',
  'help',
  'freebet',
  'claim_status',
  'refund',
  'risk',
  'objective',
  'strategy',
  'my_reports',
  'cancel',
] as const;

export const adminCommands = [
  'operator_decide',
  'operator_simulate',
  'operator_approve',
  'operator_policy',
] as const;

export type UserCommand = (typeof userCommands)[number];
export type AdminCommand = (typeof adminCommands)[number];
export type TelegramCommand = UserCommand | AdminCommand;

const adminCommandSet = new Set<string>(adminCommands);
const userCommandSet = new Set<string>(userCommands);

export class TelegramPermissionModel {
  private readonly adminIds: Set<string>;

  constructor(config: Pick<AgentConfig, 'telegram'>) {
    this.adminIds = new Set(config.telegram.adminIds.map((id) => normalizeTelegramId(id)));
  }

  roleFor(user: TelegramUserContext): TelegramRole {
    return this.adminIds.has(normalizeTelegramId(user.id)) ? 'admin' : 'user';
  }

  canRun(command: string, user: TelegramUserContext): TelegramPermissionDecision {
    const normalizedCommand = normalizeCommand(command);
    const userId = normalizeTelegramId(user.id);
    const role = this.roleFor(user);

    if (adminCommandSet.has(normalizedCommand)) {
      if (role === 'admin') {
        return {
          allowed: true,
          role,
          reason: 'Admin command allowed by Telegram numeric user id.',
          userId,
        };
      }

      return {
        allowed: false,
        role,
        reason: 'Admin command denied; Telegram user id is not in TELEGRAM_ADMIN_IDS.',
        userId,
      };
    }

    if (userCommandSet.has(normalizedCommand)) {
      return {
        allowed: true,
        role,
        reason: 'User command allowed.',
        userId,
      };
    }

    return {
      allowed: false,
      role,
      reason: `Unknown Telegram command: ${normalizedCommand}`,
      userId,
    };
  }
}

export function normalizeTelegramId(id: string | number): string {
  return String(id).trim();
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/^\//, '').split('@')[0] ?? '';
}
