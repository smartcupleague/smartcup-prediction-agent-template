import type {
  IndexerActivityFilter,
  IndexerActivityRecord,
  IndexerBet,
  IndexerBolaoMatch,
  IndexerFinalPrizeClaim,
  IndexerMatchFilter,
  IndexerMatchReward,
  IndexerMatchWalletFilter,
  IndexerPageOptions,
  IndexerUserStat,
  IndexerWalletFilter,
} from '../types/index.js';

type GraphqlError = {
  message: string;
  path?: readonly string[];
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: GraphqlError[];
};

type Nodes<T> = {
  nodes: T[];
};

const DEFAULT_FIRST = 100;
const MAX_FIRST = 500;
const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

function pageSize(first: number | undefined): number {
  if (first === undefined) return DEFAULT_FIRST;
  if (!Number.isFinite(first) || first < 1) return DEFAULT_FIRST;
  return Math.min(Math.floor(first), MAX_FIRST);
}

function gqlString(value: string): string {
  return JSON.stringify(value);
}

function gqlStringList(values: readonly string[]): string {
  return `[${values.map(gqlString).join(', ')}]`;
}

function joinFilter(parts: string[]): string {
  const active = parts.filter(Boolean);
  return active.length > 0 ? `filter: { ${active.join(', ')} },` : '';
}

function matchFilter(options: IndexerMatchFilter = {}): string {
  return joinFilter([
    options.phase ? `phase: { equalTo: ${gqlString(options.phase)} }` : '',
    options.statusIn && options.statusIn.length > 0 ? `status: { in: ${gqlStringList(options.statusIn)} }` : '',
  ]);
}

function walletFilter(options: IndexerWalletFilter = {}): string {
  return joinFilter([options.user ? `user: { equalTo: ${gqlString(String(options.user))} }` : '']);
}

function matchWalletFilter(options: IndexerMatchWalletFilter = {}): string {
  return joinFilter([
    options.user ? `user: { equalTo: ${gqlString(String(options.user))} }` : '',
    options.matchId !== undefined ? `matchId: { equalTo: ${gqlString(String(options.matchId))} }` : '',
  ]);
}

function activityFilter(options: IndexerActivityFilter = {}): string {
  return joinFilter([
    options.user ? `user: { equalTo: ${gqlString(String(options.user))} }` : '',
    options.matchId !== undefined ? `matchId: { equalTo: ${gqlString(String(options.matchId))} }` : '',
    options.type ? `type: { equalTo: ${gqlString(options.type)} }` : '',
  ]);
}

const MATCH_FIELDS = `
  id
  matchId
  phase
  home
  away
  kickOff
  status
  scoreHome
  scoreAway
  penaltyWinner
  prizePoolRaw
  betsCount
  createdAt
  updatedAt
`;

const BET_FIELDS = `
  id
  user
  matchId
  scoreHome
  scoreAway
  penaltyWinner
  stakeRaw
  blockNumber
  timestamp
`;

const USER_STAT_FIELDS = `
  id
  totalBets
  totalStakedRaw
  totalPoints
  totalClaimedRaw
  finalPrizeClaimedRaw
  updatedAt
`;

const REWARD_FIELDS = `
  id
  matchId
  user
  amountRaw
  blockNumber
  timestamp
`;

const FINAL_PRIZE_CLAIM_FIELDS = `
  id
  user
  amountRaw
  blockNumber
  timestamp
`;

const ACTIVITY_FIELDS = `
  id
  type
  user
  matchId
  amountRaw
  points
  meta
  blockNumber
  timestamp
`;

export class IndexerAdapter {
  constructor(
    private readonly graphqlUrl: string,
    private readonly timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  getEndpoint(): string {
    return this.graphqlUrl;
  }

  async listMatches(options: IndexerMatchFilter = {}): Promise<IndexerBolaoMatch[]> {
    const query = `
      query SmartPredictorMatches {
        allBolaoMatches(${matchFilter(options)} orderBy: KICK_OFF_ASC, first: ${pageSize(options.first)}) {
          nodes { ${MATCH_FIELDS} }
        }
      }
    `;
    const data = await this.query<{ allBolaoMatches: Nodes<IndexerBolaoMatch> }>(query);
    return data.allBolaoMatches.nodes;
  }

  async getMatch(matchId: string | number | bigint): Promise<IndexerBolaoMatch | null> {
    const query = `
      query SmartPredictorMatch {
        allBolaoMatches(filter: { matchId: { equalTo: ${gqlString(String(matchId))} } }, first: 1) {
          nodes { ${MATCH_FIELDS} }
        }
      }
    `;
    const data = await this.query<{ allBolaoMatches: Nodes<IndexerBolaoMatch> }>(query);
    return data.allBolaoMatches.nodes[0] ?? null;
  }

  async listBets(options: IndexerMatchWalletFilter = {}): Promise<IndexerBet[]> {
    const query = `
      query SmartPredictorBets {
        allBets(${matchWalletFilter(options)} orderBy: TIMESTAMP_DESC, first: ${pageSize(options.first)}) {
          nodes {
            ${BET_FIELDS}
          }
        }
      }
    `;
    const data = await this.query<{ allBets: Nodes<IndexerBet> }>(query);
    return data.allBets.nodes;
  }

  async getUserStat(user: string): Promise<IndexerUserStat | null> {
    const query = `
      query SmartPredictorUserStat($user: String!) {
        userStat(id: $user) { ${USER_STAT_FIELDS} }
      }
    `;
    const data = await this.query<{ userStat: IndexerUserStat | null }>(query, { user });
    return data.userStat;
  }

  async listUserStats(options: IndexerPageOptions = {}): Promise<IndexerUserStat[]> {
    const query = `
      query SmartPredictorUserStats {
        allUserStats(orderBy: TOTAL_POINTS_DESC, first: ${pageSize(options.first)}) {
          nodes { ${USER_STAT_FIELDS} }
        }
      }
    `;
    const data = await this.query<{ allUserStats: Nodes<IndexerUserStat> }>(query);
    return data.allUserStats.nodes;
  }

  async listMatchRewards(options: IndexerMatchWalletFilter = {}): Promise<IndexerMatchReward[]> {
    const query = `
      query SmartPredictorMatchRewards {
        allMatchRewards(${matchWalletFilter(options)} orderBy: TIMESTAMP_DESC, first: ${pageSize(options.first)}) {
          nodes {
            ${REWARD_FIELDS}
          }
        }
      }
    `;
    const data = await this.query<{ allMatchRewards: Nodes<IndexerMatchReward> }>(query);
    return data.allMatchRewards.nodes;
  }

  async listFinalPrizeClaims(options: IndexerWalletFilter = {}): Promise<IndexerFinalPrizeClaim[]> {
    const query = `
      query SmartPredictorFinalPrizeClaims {
        allFinalPrizeClaims(${walletFilter(options)} orderBy: TIMESTAMP_DESC, first: ${pageSize(options.first)}) {
          nodes { ${FINAL_PRIZE_CLAIM_FIELDS} }
        }
      }
    `;
    const data = await this.query<{ allFinalPrizeClaims: Nodes<IndexerFinalPrizeClaim> }>(query);
    return data.allFinalPrizeClaims.nodes;
  }

  async listActivityRecords(options: IndexerActivityFilter = {}): Promise<IndexerActivityRecord[]> {
    const query = `
      query SmartPredictorActivityRecords {
        allActivityRecords(${activityFilter(options)} orderBy: TIMESTAMP_DESC, first: ${pageSize(options.first)}) {
          nodes { ${ACTIVITY_FIELDS} }
        }
      }
    `;
    const data = await this.query<{ allActivityRecords: Nodes<IndexerActivityRecord> }>(query);
    return data.allActivityRecords.nodes;
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const queryForAttempt = attempt === 1 ? query : uniquifyGraphqlOperation(query, attempt);
        const response = await fetch(this.graphqlUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: queryForAttempt, variables }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        const payload = parseJson<GraphqlResponse<T>>(text, `Indexer GraphQL response from ${this.graphqlUrl}`);
        if (!response.ok) {
          throw new Error(`Indexer GraphQL HTTP ${response.status}: ${JSON.stringify(payload)}`);
        }
        if (payload.errors && payload.errors.length > 0) {
          throw new Error(`Indexer GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
        }
        if (!payload.data) {
          throw new Error('Indexer GraphQL response did not include data');
        }
        return payload.data;
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_ATTEMPTS || !isRetryableIndexerError(error)) break;
        await sleep(retryDelayMs(attempt, error));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const preview = text.slice(0, 500);
    throw new Error(`${label} was not valid JSON: ${preview}`, { cause: error });
  }
}

function isRetryableIndexerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /aborted|timeout|terminated|econnreset|socket|fetch failed|prepared statement .* already exists/i.test(message)
  );
}

function uniquifyGraphqlOperation(query: string, attempt: number): string {
  const suffix = `SmartPredictorRetry${attempt}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const namedQueryPattern = /\bquery\s+([A-Za-z][_0-9A-Za-z]*)/;
  if (namedQueryPattern.test(query)) {
    return query.replace(namedQueryPattern, (_match, name: string) => `query ${name}_${suffix}`);
  }
  return `# ${suffix}\n${query}`;
}

function retryDelayMs(attempt: number, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const base = /prepared statement .* already exists/i.test(message) ? 150 : 1_000 * attempt;
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
