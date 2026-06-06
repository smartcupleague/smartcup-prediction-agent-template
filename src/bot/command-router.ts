import {
  adminCommands,
  userCommands,
  normalizeCommand,
  type TelegramCommand,
} from './permissions.js';

const knownCommandSet = new Set<string>([...userCommands, ...adminCommands]);

export type TelegramMessageRoute =
  | {
      kind: 'slash_command';
      command: TelegramCommand;
      rawCommand: string;
    }
  | {
      kind: 'unknown_slash_command';
      command: string;
      rawCommand: string;
    }
  | {
      kind: 'wizard_text';
    }
  | {
      kind: 'natural_language';
    };

export function isKnownTelegramCommand(command: string): command is TelegramCommand {
  return knownCommandSet.has(normalizeCommand(command));
}

export function resolveTelegramMessageRoute(
  text: string,
  options: { hasWizardSession?: boolean } = {},
): TelegramMessageRoute {
  const trimmed = text.trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? '';

  if (firstToken.startsWith('/')) {
    const command = normalizeCommand(firstToken);
    if (isKnownTelegramCommand(command)) {
      return {
        kind: 'slash_command',
        command,
        rawCommand: firstToken,
      };
    }

    return {
      kind: 'unknown_slash_command',
      command,
      rawCommand: firstToken,
    };
  }

  if (options.hasWizardSession) {
    return { kind: 'wizard_text' };
  }

  return { kind: 'natural_language' };
}
