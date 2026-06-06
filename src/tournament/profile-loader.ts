import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { IoSmartCupState, PhaseConfig, TournamentPhaseProfile, TournamentProfile } from '../types/index.js';
import { assertTournamentProfile } from './tournament-profile.js';

export async function loadTournamentProfile(profilePath: string): Promise<TournamentProfile> {
  const raw = await readFile(resolve(profilePath), 'utf8');
  return assertTournamentProfile(JSON.parse(raw) as TournamentProfile);
}

export type TournamentProfileOption = {
  tournamentId: string;
  name: string;
  slug: string;
  path: string;
  active: boolean;
};

export async function listTournamentProfileOptions(activeProfilePath: string): Promise<TournamentProfileOption[]> {
  const activePath = resolve(activeProfilePath);
  const tournamentDir = dirname(activePath);
  const entries = await readdir(tournamentDir, { withFileTypes: true });
  const options: TournamentProfileOption[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const profilePath = join(tournamentDir, entry.name);
    const profile = await loadTournamentProfile(profilePath);
    options.push({
      tournamentId: profile.tournamentId,
      name: profile.name,
      slug: profile.slug,
      path: profilePath,
      active: resolve(profilePath) === activePath,
    });
  }

  return options.sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function getPhaseForSmartCupName(
  profile: TournamentProfile,
  smartcupPhaseName: string,
): TournamentPhaseProfile | null {
  return (
    profile.phases.find((phase) =>
      phase.smartcupPhaseNames.some((name) => name.toLowerCase() === smartcupPhaseName.toLowerCase()),
    ) ?? null
  );
}

export function getPhaseWeight(profile: TournamentProfile, smartcupPhaseName: string): number | null {
  return getPhaseForSmartCupName(profile, smartcupPhaseName)?.pointsWeight ?? null;
}

export function reconcileTournamentProfileWithChain(
  profile: TournamentProfile,
  state: Pick<IoSmartCupState, 'phases' | 'r32_lock_time' | 'podium_finalized'>,
): TournamentProfile {
  const phases = [...profile.phases];

  for (const chainPhase of state.phases) {
    const existingIndex = phases.findIndex((phase) => phaseMatchesChain(phase, chainPhase));
    const existingPhase = existingIndex >= 0 ? (phases[existingIndex] ?? null) : null;
    const normalizedPhase = normalizeChainPhase(chainPhase, existingPhase);

    if (existingIndex >= 0) {
      phases[existingIndex] = normalizedPhase;
    } else {
      phases.push(normalizedPhase);
    }
  }

  const podiumPick =
    profile.podiumPick && state.r32_lock_time
      ? {
          ...profile.podiumPick,
          kickoffAt: new Date(Number(state.r32_lock_time)).toISOString(),
          lockSource: 'contract_r32_lock_time' as const,
        }
      : profile.podiumPick;

  return assertTournamentProfile({
    ...profile,
    phases,
    podiumPick,
    notes: [
      ...(profile.notes ?? []),
      `Live BolaoCore reconciliation: ${state.phases.length} phase(s) fetched from chain.`,
      state.r32_lock_time
        ? `Live BolaoCore r32_lock_time: ${new Date(Number(state.r32_lock_time)).toISOString()}.`
        : 'Live BolaoCore r32_lock_time is not set yet.',
      `Live BolaoCore podium_finalized: ${state.podium_finalized}.`,
    ],
  });
}

function phaseMatchesChain(profilePhase: TournamentPhaseProfile, chainPhase: PhaseConfig): boolean {
  return profilePhase.smartcupPhaseNames.some((name) => name.toLowerCase() === chainPhase.name.toLowerCase());
}

function normalizeChainPhase(chainPhase: PhaseConfig, existing: TournamentPhaseProfile | null): TournamentPhaseProfile {
  return {
    key: existing?.key ?? 'custom',
    name: existing?.name ?? chainPhase.name,
    smartcupPhaseNames: existing?.smartcupPhaseNames.includes(chainPhase.name)
      ? existing.smartcupPhaseNames
      : [...(existing?.smartcupPhaseNames ?? []), chainPhase.name],
    pointsWeight: chainPhase.points_weight,
    weightSource: 'contract',
    description: existing
      ? `Live BolaoCore phase registration overrides profile weight. Previous description: ${existing.description ?? 'none'}`
      : 'Live BolaoCore phase registration discovered after profile creation.',
    startsAt: new Date(Number(chainPhase.start_time)).toISOString(),
    endsAt: new Date(Number(chainPhase.end_time)).toISOString(),
    matchIdRange: existing?.matchIdRange ?? null,
  };
}
