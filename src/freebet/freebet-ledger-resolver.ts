import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ActorId, AgentConfig, HexAddress } from '../types/index.js';

export type FreebetLedgerProgramSource =
  | 'config'
  | 'bolao_state'
  | 'decision_chain_snapshot'
  | 'tournament_profile'
  | 'missing';

export type FreebetLedgerProgramResolution = {
  programId: HexAddress | null;
  source: FreebetLedgerProgramSource;
};

export type FreebetLedgerProgramResolutionInput = {
  bolaoStateLedgerId?: ActorId | null;
  decisionChainLedgerId?: ActorId | null;
};

export function resolveFreebetLedgerProgramId(
  config: AgentConfig,
  input: FreebetLedgerProgramResolutionInput = {},
): FreebetLedgerProgramResolution {
  if (config.programs.freebetLedger) {
    return { programId: config.programs.freebetLedger, source: 'config' };
  }

  if (input.bolaoStateLedgerId) {
    return { programId: input.bolaoStateLedgerId as HexAddress, source: 'bolao_state' };
  }

  if (input.decisionChainLedgerId) {
    return { programId: input.decisionChainLedgerId as HexAddress, source: 'decision_chain_snapshot' };
  }

  const profileLedgerId = readTournamentProfileFreebetLedger(config);
  if (profileLedgerId) {
    return { programId: profileLedgerId, source: 'tournament_profile' };
  }

  return { programId: null, source: 'missing' };
}

function readTournamentProfileFreebetLedger(config: AgentConfig): HexAddress | null {
  try {
    const raw = readFileSync(resolve(config.artifacts.tournamentProfilePath), 'utf8');
    const parsed = JSON.parse(raw) as {
      programs?: {
        freebetLedger?: unknown;
      };
    };
    const ledger = parsed.programs?.freebetLedger;
    return typeof ledger === 'string' && /^0x[0-9a-fA-F]+$/.test(ledger) ? (ledger as HexAddress) : null;
  } catch {
    return null;
  }
}
