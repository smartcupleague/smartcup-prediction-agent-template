import type { PenaltyWinner, Score, TransactionSafetyCheck } from '../types/index.js';

export type PlaceBetPayloadInput = {
  matchId: string;
  phase: string;
  score: Score;
  penaltyWinner: PenaltyWinner | null;
};

export type PlaceBetPayloadEvaluation = {
  check: TransactionSafetyCheck;
  blocked: boolean;
};

export function evaluatePlaceBetPayload(input: PlaceBetPayloadInput): PlaceBetPayloadEvaluation {
  const outcome = scoreOutcome(input.score);
  const knockout = isKnockoutPhase(input.phase);
  const details = {
    matchId: input.matchId,
    phase: input.phase,
    score: input.score,
    outcome,
    penaltyWinner: input.penaltyWinner,
    knockout,
  };

  if (outcome !== 'draw' && input.penaltyWinner !== null) {
    return fail('Non-draw PlaceBet payload must not include a penalty winner.', details);
  }

  if (outcome === 'draw' && !knockout && input.penaltyWinner !== null) {
    return fail('Group-stage/non-knockout draw must not include a penalty winner.', details);
  }

  if (outcome === 'draw' && knockout && input.penaltyWinner === null) {
    return fail('Knockout draw PlaceBet payload requires a penalty winner.', details);
  }

  return {
    blocked: false,
    check: {
      name: 'place_bet_payload',
      status: 'pass',
      message: 'PlaceBet score and penalty-winner payload is valid for the match phase.',
      details,
    },
  };
}

function fail(message: string, details: Record<string, unknown>): PlaceBetPayloadEvaluation {
  return {
    blocked: true,
    check: {
      name: 'place_bet_payload',
      status: 'fail',
      message,
      details,
    },
  };
}

function scoreOutcome(score: Score): 'home' | 'draw' | 'away' {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

function isKnockoutPhase(phase: string): boolean {
  const normalized = phase.toLowerCase();
  if (normalized.includes('group')) return false;

  return (
    normalized.includes('round of') ||
    normalized.includes('r32') ||
    normalized.includes('r16') ||
    normalized.includes('quarter') ||
    normalized.includes('semi') ||
    normalized.includes('third') ||
    normalized.includes('final')
  );
}
