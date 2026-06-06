import { BolaoChainClient } from './bolao-chain-client.js';
import type {
  ActorId,
  AgentConfig,
  BolaoMatch,
  FinalPrizeClaimStatus,
  IoSmartCupState,
  MatchStatus,
  SmartCupMatch,
  UserBetView,
  WalletClaimStatus,
} from '../types/index.js';

export class SmartCupStateAdapter {
  private readonly chain: BolaoChainClient;

  constructor(private readonly config: AgentConfig, chainClient?: BolaoChainClient) {
    this.chain = chainClient ?? new BolaoChainClient(config);
  }

  getProgramId(): string {
    return this.config.programs.bolaoCore;
  }

  queryState(): Promise<IoSmartCupState> {
    return this.chain.queryState();
  }

  queryMatch(matchId: string | number | bigint): Promise<BolaoMatch | null> {
    return this.chain.queryMatch(matchId);
  }

  queryBetsByUser(user: ActorId): Promise<UserBetView[]> {
    return this.chain.queryBetsByUser(user);
  }

  queryUserPoints(user: ActorId): Promise<number> {
    return this.chain.queryUserPoints(user);
  }

  queryWalletClaimStatus(wallet: ActorId): Promise<WalletClaimStatus> {
    return this.chain.queryWalletClaimStatus(wallet);
  }

  queryFinalPrizeClaimStatus(wallet: ActorId): Promise<FinalPrizeClaimStatus> {
    return this.chain.queryFinalPrizeClaimStatus(wallet);
  }

  async listMatches(): Promise<SmartCupMatch[]> {
    const state = await this.queryState();
    return state.matches.map(toSmartCupMatch);
  }
}

function toSmartCupMatch(match: BolaoMatch): SmartCupMatch {
  return {
    matchId: match.match_id,
    phase: match.phase,
    home: match.home,
    away: match.away,
    kickOffMs: Number(match.kick_off),
    status: toMatchStatus(match),
  };
}

function toMatchStatus(match: BolaoMatch): MatchStatus {
  if (match.result.kind === 'Cancelled') return 'CANCELLED';
  if (match.settlement_prepared) return 'SETTLED';
  if (match.result.kind === 'Finalized') return 'FINALIZED';
  if (match.result.kind === 'Proposed') return 'PROPOSED';
  return 'UNRESOLVED';
}
