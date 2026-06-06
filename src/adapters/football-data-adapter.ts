import type {
  FixtureResultProvider,
  FootballDataFixtureQuery,
  NormalizedFootballMatch,
  NormalizedFootballTeam,
  ProviderBatch,
  ProviderDescriptor,
  ProviderHealth,
  ProviderMatchStatus,
  ProviderRequestContext,
  Score,
} from '../types/index.js';

type FootballDataAdapterOptions = {
  baseUrl?: string;
  apiToken?: string | null;
};

type RawFootballDataMatch = Record<string, unknown>;
const FETCH_TIMEOUT_MS = 15_000;

export class FootballDataAdapter implements FixtureResultProvider {
  readonly descriptor: ProviderDescriptor;

  private readonly baseUrl: string;
  private readonly apiToken: string | null;

  constructor(options: FootballDataAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.football-data.org/v4').replace(/\/$/, '');
    this.apiToken = options.apiToken || null;
    this.descriptor = {
      id: 'football-data.org',
      displayName: 'football-data.org',
      capabilities: ['fixtures', 'results'],
      baseUrl: this.baseUrl,
      requiresApiToken: true,
      notes: ['Used as the primary normalized fixture/result source for the SmartCup prediction agent.'],
    };
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken);
  }

  async health(): Promise<ProviderHealth> {
    return {
      providerId: this.descriptor.id,
      status: this.isConfigured() ? 'configured' : 'missing_credentials',
      checkedAt: new Date().toISOString(),
      message: this.isConfigured()
        ? 'football-data.org token is configured.'
        : 'Set FOOTBALL_DATA_API_TOKEN in the local environment to enable fixture/result ingestion.',
    };
  }

  async fetch(
    query: FootballDataFixtureQuery = {},
    _context: ProviderRequestContext = {},
  ): Promise<ProviderBatch<NormalizedFootballMatch>> {
    const records = await this.listCompetitionMatches(query);
    return {
      provider: this.descriptor.id,
      capability: 'fixtures',
      fetchedAt: new Date().toISOString(),
      records,
    };
  }

  async listCompetitionMatches(query: FootballDataFixtureQuery = {}): Promise<NormalizedFootballMatch[]> {
    this.assertConfigured();
    const competition = query.competition ?? 'WC';
    const data = await this.getJson(`/competitions/${encodeURIComponent(competition)}/matches`, queryParams(query));
    const matches = recordArray(data, 'matches');
    return matches.map(normalizeMatch);
  }

  async listTeamMatches(teamId: string | number, query: FootballDataFixtureQuery = {}): Promise<NormalizedFootballMatch[]> {
    this.assertConfigured();
    const data = await this.getJson(`/teams/${encodeURIComponent(String(teamId))}/matches`, queryParams(query));
    const matches = recordArray(data, 'matches');
    return matches.map(normalizeMatch);
  }

  async getMatch(matchId: string | number): Promise<NormalizedFootballMatch> {
    this.assertConfigured();
    return normalizeMatch(asRecord(await this.getJson(`/matches/${encodeURIComponent(String(matchId))}`), 'match'));
  }

  private async getJson(path: string, params: URLSearchParams = new URLSearchParams()): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of params) url.searchParams.set(key, value);

    const response = await fetch(url, {
      headers: {
        'X-Auth-Token': this.apiToken ?? '',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`football-data.org ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
    }

    const text = await response.text();
    return parseJson(text, `football-data.org response from ${url.pathname}`);
  }

  private assertConfigured(): void {
    if (!this.apiToken) {
      throw new Error('FOOTBALL_DATA_API_TOKEN is required for football-data.org ingestion.');
    }
  }
}

function queryParams(query: FootballDataFixtureQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.season !== undefined) params.set('season', String(query.season));
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  if (query.status) params.set('status', query.status);
  if (query.matchday !== undefined) params.set('matchday', String(query.matchday));
  return params;
}

function normalizeMatch(raw: RawFootballDataMatch): NormalizedFootballMatch {
  const competition = asRecordOrNull(raw.competition);
  const season = asRecordOrNull(raw.season);
  const score = asRecordOrNull(raw.score);

  return {
    provider: 'football-data.org',
    providerMatchId: stringValue(raw.id),
    competitionCode: nullableString(competition?.code),
    competitionName: nullableString(competition?.name),
    seasonStartYear: yearFromDate(nullableString(season?.startDate)),
    utcDate: stringValue(raw.utcDate),
    status: normalizeStatus(raw.status),
    stage: nullableString(raw.stage),
    matchday: nullableNumber(raw.matchday),
    group: nullableString(raw.group),
    homeTeam: normalizeTeam(asRecord(raw.homeTeam, 'homeTeam')),
    awayTeam: normalizeTeam(asRecord(raw.awayTeam, 'awayTeam')),
    score: {
      winner: normalizeWinner(score?.winner),
      duration: nullableString(score?.duration),
      fullTime: normalizeScore(asRecordOrNull(score?.fullTime)),
      regularTime: normalizeScore(asRecordOrNull(score?.regularTime)),
      extraTime: normalizeScore(asRecordOrNull(score?.extraTime)),
      penalties: normalizeScore(asRecordOrNull(score?.penalties)),
    },
    lastUpdated: nullableString(raw.lastUpdated),
  };
}

function normalizeTeam(raw: Record<string, unknown>): NormalizedFootballTeam {
  return {
    provider: 'football-data.org',
    id: raw.id === null || raw.id === undefined ? null : String(raw.id),
    name: stringValue(raw.name),
    shortName: nullableString(raw.shortName),
    tla: nullableString(raw.tla),
  };
}

function normalizeScore(raw: Record<string, unknown> | null): Score | null {
  if (!raw) return null;
  const home = nullableNumber(raw.home);
  const away = nullableNumber(raw.away);
  if (home === null || away === null) return null;
  return { home, away };
}

function normalizeStatus(value: unknown): ProviderMatchStatus {
  const status = typeof value === 'string' ? value : 'UNKNOWN';
  if (
    status === 'SCHEDULED' ||
    status === 'TIMED' ||
    status === 'IN_PLAY' ||
    status === 'PAUSED' ||
    status === 'FINISHED' ||
    status === 'POSTPONED' ||
    status === 'SUSPENDED' ||
    status === 'CANCELLED'
  ) {
    return status;
  }
  return 'UNKNOWN';
}

function normalizeWinner(value: unknown): 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null {
  return value === 'HOME_TEAM' || value === 'AWAY_TEAM' || value === 'DRAW' ? value : null;
}

function recordArray(value: unknown, key: string): RawFootballDataMatch[] {
  const raw = asRecord(value, 'football-data response');
  const list = raw[key];
  return Array.isArray(list) ? list.map((entry) => asRecord(entry, key)) : [];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value as Record<string, unknown>;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function yearFromDate(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${text.slice(0, 500)}`, { cause: error });
  }
}
