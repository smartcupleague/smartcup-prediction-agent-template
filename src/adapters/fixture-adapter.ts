import { getPhaseWeight } from '../tournament/index.js';
import type {
  ActorId,
  BolaoMatch,
  EligibleMatchPlan,
  MatchEligibilityReason,
  MatchEligibilityView,
  MatchStatus,
  SmartCupMatch,
  TournamentProfile,
  UserBetView,
} from '../types/index.js';

export class FixtureAdapter {
  getEligibleMatches(matches: SmartCupMatch[], nowMs = Date.now(), cutoffBufferMs = 15 * 60 * 1000): SmartCupMatch[] {
    return matches.filter((match) => {
      const closesAt = match.kickOffMs - 10 * 60 * 1000;
      return match.status === 'UNRESOLVED' && closesAt - nowMs > cutoffBufferMs;
    });
  }

  buildEligibleMatchPlan(input: {
    wallet: ActorId;
    matches: BolaoMatch[];
    userBets: UserBetView[];
    profile: TournamentProfile;
    nowMs?: number;
  }): EligibleMatchPlan {
    const nowMs = input.nowMs ?? Date.now();
    const betMatchIds = new Set(input.userBets.map((bet) => bet.match_id));
    const evaluated = input.matches.map((match) =>
      evaluateMatchEligibility(match, input.profile, betMatchIds, nowMs),
    );

    return {
      generatedAt: new Date(nowMs).toISOString(),
      wallet: input.wallet,
      cutoff: input.profile.cutoff,
      totalMatches: evaluated.length,
      eligibleMatches: evaluated
        .filter((match) => match.eligible)
        .sort((a, b) => a.agentSafetyCloseMs - b.agentSafetyCloseMs),
      ineligibleMatches: evaluated
        .filter((match) => !match.eligible)
        .sort((a, b) => a.agentSafetyCloseMs - b.agentSafetyCloseMs),
    };
  }
}

function evaluateMatchEligibility(
  match: BolaoMatch,
  profile: TournamentProfile,
  betMatchIds: Set<string>,
  nowMs: number,
): MatchEligibilityView {
  const kickOffMs = Number(match.kick_off);
  const predictionCutoffMs = kickOffMs - profile.cutoff.predictionCutoffMinutes * 60_000;
  const agentSafetyCloseMs = predictionCutoffMs - profile.cutoff.safetyBufferMs;
  const status = toMatchStatus(match);
  const reasons: MatchEligibilityReason[] = [];

  if (!Number.isFinite(kickOffMs) || kickOffMs <= 0) reasons.push('invalid_kickoff');
  if (betMatchIds.has(match.match_id)) reasons.push('already_predicted');
  if (status === 'CANCELLED') reasons.push('cancelled');
  if (status === 'FINALIZED') reasons.push('finalized');
  if (status === 'SETTLED') reasons.push('settled');
  if (status === 'PROPOSED') reasons.push('result_proposed');
  if (status !== 'UNRESOLVED') reasons.push('not_unresolved');
  if (agentSafetyCloseMs - nowMs <= 0) reasons.push('cutoff_buffer_breached');

  return {
    matchId: match.match_id,
    phase: match.phase,
    phaseWeight: getPhaseWeight(profile, match.phase),
    home: match.home,
    away: match.away,
    kickOffMs,
    predictionCutoffMs,
    agentSafetyCloseMs,
    timeUntilSafetyCloseMs: agentSafetyCloseMs - nowMs,
    status,
    eligible: reasons.length === 0,
    reasons,
  };
}

function toMatchStatus(match: BolaoMatch): MatchStatus {
  if (match.result.kind === 'Cancelled') return 'CANCELLED';
  if (match.settlement_prepared) return 'SETTLED';
  if (match.result.kind === 'Finalized') return 'FINALIZED';
  if (match.result.kind === 'Proposed') return 'PROPOSED';
  return 'UNRESOLVED';
}
