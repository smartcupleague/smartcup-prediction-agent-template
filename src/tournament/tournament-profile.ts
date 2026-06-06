import type { TournamentPhaseKey, TournamentProfile } from '../types/index.js';

export const TOURNAMENT_PROFILE_SCHEMA_VERSION = 'smartpredictor.tournament-profile.v1' as const;

export const TOURNAMENT_PHASE_KEYS = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'custom',
] as const satisfies readonly TournamentPhaseKey[];

export const TOURNAMENT_PROFILE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartpredictor.local/schemas/tournament-profile.v1.json',
  title: 'SmartPredictor TournamentProfile',
  type: 'object',
  required: [
    'schemaVersion',
    'tournamentId',
    'slug',
    'name',
    'season',
    'timezone',
    'matchCount',
    'defaultRiskMode',
    'programs',
    'providers',
    'cutoff',
    'entry',
    'scoring',
    'claims',
    'rewardSplit',
    'finalPrize',
    'phases',
    'podiumPick',
  ],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: TOURNAMENT_PROFILE_SCHEMA_VERSION },
    tournamentId: { type: 'string', minLength: 1 },
    slug: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    season: { type: 'string', minLength: 1 },
    timezone: { type: 'string', minLength: 1 },
    matchCount: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    defaultRiskMode: {
      enum: ['conservative', 'balanced', 'contrarian', 'catch_up', 'protect_lead', 'final_swing'],
    },
    programs: {
      type: 'object',
      required: ['bolaoCore', 'oracle'],
      additionalProperties: false,
      properties: {
        bolaoCore: { type: 'string', pattern: '^0x[0-9a-fA-F]+$' },
        oracle: { type: 'string', pattern: '^0x[0-9a-fA-F]+$' },
        freebetLedger: {
          anyOf: [{ type: 'string', pattern: '^0x[0-9a-fA-F]+$' }, { type: 'null' }],
        },
      },
    },
    providers: {
      type: 'object',
      required: ['fixtures'],
      additionalProperties: false,
      properties: {
        fixtures: { const: 'football-data.org' },
        odds: { type: 'array', items: { type: 'string' } },
        news: { type: 'array', items: { type: 'string' } },
        injuries: { type: 'array', items: { type: 'string' } },
      },
    },
    cutoff: {
      type: 'object',
      required: ['predictionCutoffMinutes', 'safetyBufferMs'],
      additionalProperties: false,
      properties: {
        predictionCutoffMinutes: { type: 'integer', minimum: 0 },
        safetyBufferMs: { type: 'integer', minimum: 0 },
      },
    },
    entry: {
      type: 'object',
      required: ['minimumEntryUsd', 'minimumEntrySource'],
      additionalProperties: false,
      properties: {
        minimumEntryUsd: { type: 'number', minimum: 0 },
        minimumEntrySource: { enum: ['dynamic_usd_to_vara', 'fixed_planck', 'operator_config'] },
      },
    },
    scoring: {
      type: 'object',
      required: ['exactScorePoints', 'correctOutcomePoints', 'incorrectPoints', 'phaseWeightsApply'],
      additionalProperties: false,
      properties: {
        exactScorePoints: { type: 'integer', minimum: 0 },
        correctOutcomePoints: { type: 'integer', minimum: 0 },
        incorrectPoints: { type: 'integer', minimum: 0 },
        phaseWeightsApply: { type: 'boolean' },
      },
    },
    claims: {
      type: 'object',
      required: ['matchRewardClaimWindowHours'],
      additionalProperties: false,
      properties: {
        matchRewardClaimWindowHours: { type: 'number', minimum: 0 },
      },
    },
    rewardSplit: {
      type: 'object',
      required: ['matchWinnerPoolBps', 'finalPrizePoolBps', 'protocolFeeBps'],
      additionalProperties: false,
      properties: {
        matchWinnerPoolBps: { type: 'integer', minimum: 0, maximum: 10000 },
        finalPrizePoolBps: { type: 'integer', minimum: 0, maximum: 10000 },
        protocolFeeBps: { type: 'integer', minimum: 0, maximum: 10000 },
      },
    },
    finalPrize: {
      type: 'object',
      required: ['placesPaid', 'distribution', 'tieBreak'],
      additionalProperties: false,
      properties: {
        placesPaid: { type: 'integer', minimum: 1 },
        distribution: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['place', 'bps'],
            additionalProperties: false,
            properties: {
              place: { type: 'integer', minimum: 1 },
              bps: { type: 'integer', minimum: 0, maximum: 10000 },
            },
          },
        },
        tieBreak: { const: 'combine_and_split_tied_positions' },
      },
    },
    phases: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'name', 'smartcupPhaseNames', 'pointsWeight', 'startsAt', 'endsAt', 'matchIdRange'],
        additionalProperties: false,
        properties: {
          key: { enum: TOURNAMENT_PHASE_KEYS },
          name: { type: 'string', minLength: 1 },
          smartcupPhaseNames: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          pointsWeight: { type: 'number', exclusiveMinimum: 0 },
          weightSource: { enum: ['contract', 'published_rules', 'operator_config', 'planned'] },
          description: { type: 'string' },
          startsAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          endsAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          matchIdRange: {
            anyOf: [
              {
                type: 'object',
                required: ['first', 'last'],
                additionalProperties: false,
                properties: {
                  first: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  last: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
    podiumPick: {
      anyOf: [
        {
          type: 'object',
          required: [
            'enabled',
            'phaseKey',
            'targetMatchId',
            'targetMatchLabel',
            'expectedMatchupDefinedAt',
            'kickoffAt',
            'opportunityWindowHours',
          ],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            phaseKey: { enum: TOURNAMENT_PHASE_KEYS },
            targetMatchId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            targetMatchLabel: { type: 'string' },
            expectedMatchupDefinedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
            kickoffAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
            lockSource: { enum: ['contract_r32_lock_time', 'published_rules', 'operator_config'] },
            opportunityWindowHours: {
              anyOf: [
                {
                  type: 'object',
                  required: ['min', 'max'],
                  additionalProperties: false,
                  properties: {
                    min: { type: 'number', minimum: 0 },
                    max: { type: 'number', minimum: 0 },
                  },
                },
                { type: 'null' },
              ],
            },
            bonusPoints: {
              type: 'object',
              required: ['championPoints', 'runnerUpPoints', 'thirdPlacePoints', 'exactPositionOnly'],
              additionalProperties: false,
              properties: {
                championPoints: { type: 'integer', minimum: 0 },
                runnerUpPoints: { type: 'integer', minimum: 0 },
                thirdPlacePoints: { type: 'integer', minimum: 0 },
                exactPositionOnly: { type: 'boolean' },
              },
            },
          },
        },
        { type: 'null' },
      ],
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function assertTournamentProfile(profile: TournamentProfile): TournamentProfile {
  const totalBps =
    profile.rewardSplit.matchWinnerPoolBps +
    profile.rewardSplit.finalPrizePoolBps +
    profile.rewardSplit.protocolFeeBps;

  if (profile.schemaVersion !== TOURNAMENT_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported tournament profile schema: ${profile.schemaVersion}`);
  }

  if (totalBps !== 10000) {
    throw new Error(`Tournament reward split must total 10000 bps, got ${totalBps}`);
  }

  const finalPrizeTotalBps = profile.finalPrize.distribution.reduce((total, entry) => total + entry.bps, 0);
  if (finalPrizeTotalBps !== 10000) {
    throw new Error(`Final prize distribution must total 10000 bps, got ${finalPrizeTotalBps}`);
  }

  if (profile.phases.length === 0) {
    throw new Error('Tournament profile must define at least one phase.');
  }

  const duplicatePhase = findDuplicate(profile.phases.flatMap((phase) => phase.smartcupPhaseNames));
  if (duplicatePhase) {
    throw new Error(`SmartCup phase name appears more than once: ${duplicatePhase}`);
  }

  if (
    profile.podiumPick?.opportunityWindowHours &&
    profile.podiumPick.opportunityWindowHours.min > profile.podiumPick.opportunityWindowHours.max
  ) {
    throw new Error('Podium opportunity min hours cannot be greater than max hours.');
  }

  return profile;
}

function findDuplicate(values: string[]): string | null {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }

  return null;
}
