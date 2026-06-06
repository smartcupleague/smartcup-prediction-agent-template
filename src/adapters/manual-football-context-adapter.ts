import type {
  FootballContextProvider,
  FootballContextProviderBatch,
  FootballContextProviderQuery,
  LineupPlayerRole,
  LineupStatus,
  NewsImpactDirection,
  NormalizedLineupSnapshot,
  NormalizedNewsItem,
  NormalizedPlayerAvailability,
  PlayerAvailabilityStatus,
  ProviderDescriptor,
  ProviderHealth,
  ProviderRequestContext,
} from '../types/index.js';

export class ManualFootballContextAdapter implements FootballContextProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'manual-football-context',
    displayName: 'Manual lineup, availability, and news context',
    capabilities: ['football_context', 'lineups', 'injuries', 'news'],
    requiresApiToken: false,
    notes: [
      'Reads normalized football context snapshots from SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON.',
      'Use this for MVP lineup/injury/suspension/news-risk testing before wiring a live provider.',
    ],
  };

  constructor(private readonly rawJson: string | null) {}

  isConfigured(): boolean {
    return Boolean(this.rawJson?.trim());
  }

  async health(): Promise<ProviderHealth> {
    if (!this.isConfigured()) {
      return {
        providerId: this.descriptor.id,
        status: 'missing_credentials',
        checkedAt: new Date().toISOString(),
        message: 'SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON is not set.',
      };
    }

    try {
      this.parseContext();
      return {
        providerId: this.descriptor.id,
        status: 'configured',
        checkedAt: new Date().toISOString(),
        message: 'Manual football context JSON parsed successfully.',
      };
    } catch (error) {
      return {
        providerId: this.descriptor.id,
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async fetchContext(
    query: FootballContextProviderQuery,
    _context: ProviderRequestContext = {},
  ): Promise<FootballContextProviderBatch> {
    const fetchedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.descriptor.id,
        fetchedAt,
        lineups: [],
        availability: [],
        news: [],
        warnings: [
          'Manual football context provider is not configured. Set SMARTCUP_FOOTBALL_CONTEXT_MANUAL_JSON to enable lineup/injury/news risk analysis.',
        ],
      };
    }

    try {
      const context = this.parseContext();
      return {
        provider: this.descriptor.id,
        fetchedAt,
        lineups: context.lineups.filter((entry) => matchesLineup(entry, query)),
        availability: context.availability.filter((entry) => matchesAvailability(entry, query)),
        news: context.news.filter((entry) => matchesNews(entry, query)),
        warnings: [],
      };
    } catch (error) {
      return {
        provider: this.descriptor.id,
        fetchedAt,
        lineups: [],
        availability: [],
        news: [],
        warnings: [`Manual football context JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  private parseContext(): {
    lineups: NormalizedLineupSnapshot[];
    availability: NormalizedPlayerAvailability[];
    news: NormalizedNewsItem[];
  } {
    const raw = JSON.parse(this.rawJson ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Manual football context JSON must be an object.');
    }
    const object = raw as Record<string, unknown>;
    return {
      lineups: arrayValue(object.lineups).map(normalizeLineup),
      availability: arrayValue(object.availability).map(normalizeAvailability),
      news: arrayValue(object.news).map(normalizeNews),
    };
  }
}

function matchesLineup(snapshot: NormalizedLineupSnapshot, query: FootballContextProviderQuery): boolean {
  if (query.matchId && snapshot.matchId && String(snapshot.matchId) !== String(query.matchId)) return false;
  if (query.teams?.length && !query.teams.some((team) => sameTeam(team, snapshot.team))) return false;
  return true;
}

function matchesAvailability(entry: NormalizedPlayerAvailability, query: FootballContextProviderQuery): boolean {
  if (query.teams?.length && !query.teams.some((team) => sameTeam(team, entry.team))) return false;
  return true;
}

function matchesNews(entry: NormalizedNewsItem, query: FootballContextProviderQuery): boolean {
  if (query.teams?.length && entry.teams.length > 0 && !entry.teams.some((team) => query.teams?.some((queryTeam) => sameTeam(queryTeam, team)))) {
    return false;
  }
  return true;
}

function normalizeLineup(value: unknown): NormalizedLineupSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each lineup snapshot must be an object.');
  const raw = value as Record<string, unknown>;
  return {
    provider: stringValue(raw.provider, 'manual'),
    matchId: nullableString(raw.matchId),
    team: stringValue(raw.team, ''),
    status: enumValue(raw.status, ['confirmed', 'probable', 'projected', 'unknown'], 'unknown') as LineupStatus,
    formation: nullableString(raw.formation),
    sourceUrl: nullableString(raw.sourceUrl),
    updatedAt: stringValue(raw.updatedAt, new Date().toISOString()),
    confidence: finiteNumber(raw.confidence, 0.5),
    players: arrayValue(raw.players).map(normalizeLineupPlayer),
  };
}

function normalizeLineupPlayer(value: unknown): NormalizedLineupSnapshot['players'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each lineup player must be an object.');
  const raw = value as Record<string, unknown>;
  return {
    player: stringValue(raw.player ?? raw.name, ''),
    position: nullableString(raw.position),
    role: enumValue(raw.role, ['starter', 'bench', 'absent', 'unknown'], 'unknown') as LineupPlayerRole,
    confidence: finiteNumber(raw.confidence, 0.5),
  };
}

function normalizeAvailability(value: unknown): NormalizedPlayerAvailability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each availability item must be an object.');
  const raw = value as Record<string, unknown>;
  return {
    provider: stringValue(raw.provider, 'manual'),
    team: stringValue(raw.team, ''),
    player: stringValue(raw.player, ''),
    status: enumValue(
      raw.status,
      ['available', 'doubtful', 'out', 'suspended', 'rested', 'unknown'],
      'unknown',
    ) as PlayerAvailabilityStatus,
    reason: nullableString(raw.reason),
    severity: enumValue(raw.severity, ['low', 'medium', 'high', 'unknown'], 'unknown') as NormalizedPlayerAvailability['severity'],
    expectedReturnAt: nullableString(raw.expectedReturnAt),
    sourceUrl: nullableString(raw.sourceUrl),
    updatedAt: stringValue(raw.updatedAt, new Date().toISOString()),
    confidence: finiteNumber(raw.confidence, 0.5),
  };
}

function normalizeNews(value: unknown): NormalizedNewsItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each news item must be an object.');
  const raw = value as Record<string, unknown>;
  return {
    provider: stringValue(raw.provider, 'manual'),
    itemId: stringValue(raw.itemId ?? raw.id, `manual-news-${hashLike(JSON.stringify(raw))}`),
    title: stringValue(raw.title, ''),
    summary: nullableString(raw.summary),
    url: nullableString(raw.url),
    publishedAt: stringValue(raw.publishedAt, new Date().toISOString()),
    teams: arrayValue(raw.teams).map((entry) => String(entry)),
    players: arrayValue(raw.players).map((entry) => String(entry)),
    tags: arrayValue(raw.tags).map((entry) => String(entry)),
    impactDirection: enumValue(raw.impactDirection, ['positive', 'negative', 'neutral', 'unknown'], 'unknown') as NewsImpactDirection,
    confidence: finiteNumber(raw.confidence, 0.5),
    sourceReliability:
      raw.sourceReliability === null || raw.sourceReliability === undefined ? null : finiteNumber(raw.sourceReliability, 0.5),
  };
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function stringValue(value: unknown, fallback: string): string {
  return value === null || value === undefined ? fallback : String(value);
}

function enumValue(value: unknown, accepted: string[], fallback: string): string {
  const candidate = String(value ?? fallback);
  return accepted.includes(candidate) ? candidate : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sameTeam(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function hashLike(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}
