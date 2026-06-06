import type {
  NormalizedOddsSnapshot,
  OddsProvider,
  OddsProviderQuery,
  ProviderBatch,
  ProviderDescriptor,
  ProviderHealth,
  ProviderRequestContext,
} from '../types/index.js';

export class ManualOddsAdapter implements OddsProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'manual',
    displayName: 'Manual odds snapshots',
    capabilities: ['odds'],
    requiresApiToken: false,
    notes: [
      'Reads normalized odds snapshots from SMARTCUP_ODDS_MANUAL_JSON.',
      'Use this for MVP market-comparison testing before wiring a live odds provider.',
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
        message: 'SMARTCUP_ODDS_MANUAL_JSON is not set.',
      };
    }

    try {
      this.parseSnapshots();
      return {
        providerId: this.descriptor.id,
        status: 'configured',
        checkedAt: new Date().toISOString(),
        message: 'Manual odds JSON parsed successfully.',
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

  async fetch(
    query: OddsProviderQuery,
    _context: ProviderRequestContext = {},
  ): Promise<ProviderBatch<NormalizedOddsSnapshot>> {
    const fetchedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        provider: this.descriptor.id,
        capability: 'odds',
        fetchedAt,
        records: [],
        warnings: ['Manual odds provider is not configured. Set SMARTCUP_ODDS_MANUAL_JSON to enable market comparison.'],
      };
    }

    try {
      const snapshots = this.parseSnapshots().filter((snapshot) => matchesQuery(snapshot, query));
      return {
        provider: this.descriptor.id,
        capability: 'odds',
        fetchedAt,
        records: snapshots,
        warnings: snapshots.length ? [] : ['No manual odds snapshot matched the requested match/market.'],
      };
    } catch (error) {
      return {
        provider: this.descriptor.id,
        capability: 'odds',
        fetchedAt,
        records: [],
        warnings: [`Manual odds JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  private parseSnapshots(): NormalizedOddsSnapshot[] {
    const raw = JSON.parse(this.rawJson ?? '[]') as unknown;
    const snapshots = Array.isArray(raw) ? raw : [raw];
    return snapshots.map(normalizeSnapshot);
  }
}

function matchesQuery(snapshot: NormalizedOddsSnapshot, query: OddsProviderQuery): boolean {
  if (query.matchId && snapshot.matchId && String(snapshot.matchId) !== String(query.matchId)) return false;
  if (query.markets?.length && !query.markets.includes(snapshot.market)) return false;
  return true;
}

function normalizeSnapshot(value: unknown): NormalizedOddsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each odds snapshot must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const selections = Array.isArray(raw.selections) ? raw.selections.map(normalizeSelection) : [];
  return {
    provider: String(raw.provider ?? 'manual'),
    providerEventId: raw.providerEventId === null || raw.providerEventId === undefined ? null : String(raw.providerEventId),
    matchId: raw.matchId === null || raw.matchId === undefined ? null : String(raw.matchId),
    market: String(raw.market ?? 'match_winner') as NormalizedOddsSnapshot['market'],
    observedAt: String(raw.observedAt ?? new Date().toISOString()),
    selections,
    sourceUrl: raw.sourceUrl === null || raw.sourceUrl === undefined ? null : String(raw.sourceUrl),
    confidence: finiteNumber(raw.confidence, 0.5),
  };
}

function normalizeSelection(value: unknown): NormalizedOddsSnapshot['selections'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each odds selection must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const priceDecimal = finiteNumber(raw.priceDecimal, 0);
  return {
    label: String(raw.label ?? raw.outcome ?? ''),
    outcome: String(raw.outcome ?? 'team') as NormalizedOddsSnapshot['selections'][number]['outcome'],
    priceDecimal,
    impliedProbability:
      raw.impliedProbability === null || raw.impliedProbability === undefined
        ? priceDecimal > 0
          ? 1 / priceDecimal
          : null
        : finiteNumber(raw.impliedProbability, 0),
    line: raw.line === null || raw.line === undefined ? null : finiteNumber(raw.line, 0),
    score: normalizeScore(raw.score),
    team: raw.team === null || raw.team === undefined ? null : String(raw.team),
    bookmaker: raw.bookmaker === null || raw.bookmaker === undefined ? null : String(raw.bookmaker),
  };
}

function normalizeScore(value: unknown): NormalizedOddsSnapshot['selections'][number]['score'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    home: finiteNumber(raw.home, 0),
    away: finiteNumber(raw.away, 0),
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
