import type {
  SmartCupApiLeaderboardResponse,
  SmartCupApiPoolDistribution,
  SmartCupApiPoolsResponse,
  SmartCupApiWalletProfile,
} from '../types/index.js';

type RawRecord = Record<string, unknown>;
const FETCH_TIMEOUT_MS = 15_000;

function asRecord(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value as RawRecord;
}

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePool(value: unknown): SmartCupApiPoolDistribution {
  const raw = asRecord(value, 'SmartCup API pool distribution');
  return {
    match_id: asString(raw.match_id),
    home_bets: asNumber(raw.home_bets),
    draw_bets: asNumber(raw.draw_bets),
    away_bets: asNumber(raw.away_bets),
    home_planck: asString(raw.home_planck, '0'),
    draw_planck: asString(raw.draw_planck, '0'),
    away_planck: asString(raw.away_planck, '0'),
    total_bets: asNumber(raw.total_bets),
    total_planck: asString(raw.total_planck, '0'),
  };
}

function normalizePoolsResponse(value: unknown): SmartCupApiPoolsResponse {
  const raw = asRecord(value, 'SmartCup API pools response');
  const pools = Array.isArray(raw.pools) ? raw.pools.map(normalizePool) : [];
  return {
    pools,
    total: asNumber(raw.total, pools.length),
  };
}

function normalizeLeaderboardResponse(value: unknown): SmartCupApiLeaderboardResponse {
  const raw = asRecord(value, 'SmartCup API leaderboard response');
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map((row) => {
        const r = asRecord(row, 'SmartCup API leaderboard row');
        return {
          wallet_address: asString(r.wallet_address).toLowerCase(),
          display_name: asNullableString(r.display_name),
          matches_count: asNumber(r.matches_count),
          exact_count: asNumber(r.exact_count),
          outcome_count: asNumber(r.outcome_count),
          total_claimed_planck: asString(r.total_claimed_planck, '0'),
          updated_at: asNullableString(r.updated_at),
        };
      })
    : [];

  return {
    rows,
    total: asNumber(raw.total, rows.length),
  };
}

function normalizeProfile(value: unknown, walletAddress: string): SmartCupApiWalletProfile {
  const raw = asRecord(value, 'SmartCup API wallet profile');
  return {
    wallet_address: asString(raw.wallet_address, walletAddress).toLowerCase(),
    display_name: asNullableString(raw.display_name),
    updated_at: asNullableString(raw.updated_at),
  };
}

export class SmartCupApiAdapter {
  constructor(private readonly baseUrl: string) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getPoolDistributions(): Promise<SmartCupApiPoolsResponse> {
    return normalizePoolsResponse(await this.getJson('/api/v1/stats/pools'));
  }

  async getPoolDistribution(matchId: string | number | bigint): Promise<SmartCupApiPoolDistribution> {
    return normalizePool(await this.getJson(`/api/v1/stats/pools/${encodeURIComponent(String(matchId))}`));
  }

  async getLeaderboardEnrichment(limit = 500): Promise<SmartCupApiLeaderboardResponse> {
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 2000)) : 500;
    return normalizeLeaderboardResponse(await this.getJson(`/api/v1/leaderboard?limit=${boundedLimit}`));
  }

  async getProfile(walletAddress: string): Promise<SmartCupApiWalletProfile> {
    const wallet = walletAddress.toLowerCase();
    return normalizeProfile(await this.getJson(`/api/v1/profiles/${encodeURIComponent(wallet)}`), wallet);
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await fetch(this.url(path), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const text = await response.text();
    const payload = text ? parseJson(text, `SmartCup API ${path} response`) : null;

    if (!response.ok) {
      throw new Error(`SmartCup API ${path} failed with HTTP ${response.status}: ${text}`);
    }
    return payload;
  }

  private url(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${text.slice(0, 500)}`, { cause: error });
  }
}
