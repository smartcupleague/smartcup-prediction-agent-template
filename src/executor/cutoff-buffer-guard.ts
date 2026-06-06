import type { TransactionSafetyCheck, U64String } from '../types/index.js';

export type CutoffBufferInput = {
  matchId: string;
  kickOff: U64String;
  predictionCutoffMinutes: number;
  safetyBufferMs: number;
  nowMs: number;
};

export type CutoffBufferEvaluation = {
  check: TransactionSafetyCheck;
  blocked: boolean;
};

export function evaluateCutoffBuffer(input: CutoffBufferInput): CutoffBufferEvaluation {
  const kickOffMs = Number(input.kickOff);

  if (!Number.isFinite(kickOffMs) || kickOffMs <= 0) {
    return {
      blocked: true,
      check: {
        name: 'cutoff_buffer',
        status: 'fail',
        message: `Match ${input.matchId} has an invalid kickoff timestamp; cutoff safety could not be proven.`,
        details: { matchId: input.matchId, kickOff: input.kickOff },
      },
    };
  }

  const predictionCutoffMs = kickOffMs - input.predictionCutoffMinutes * 60_000;
  const agentSafetyCloseMs = predictionCutoffMs - input.safetyBufferMs;
  const timeUntilSafetyCloseMs = agentSafetyCloseMs - input.nowMs;
  const details = {
    matchId: input.matchId,
    kickOffMs,
    predictionCutoffMinutes: input.predictionCutoffMinutes,
    safetyBufferMs: input.safetyBufferMs,
    predictionCutoffMs,
    agentSafetyCloseMs,
    nowMs: input.nowMs,
    timeUntilSafetyCloseMs,
  };

  if (timeUntilSafetyCloseMs <= 0) {
    return {
      blocked: true,
      check: {
        name: 'cutoff_buffer',
        status: 'fail',
        message: `Match ${input.matchId} is inside the SmartCup cutoff plus agent safety buffer.`,
        details,
      },
    };
  }

  return {
    blocked: false,
    check: {
      name: 'cutoff_buffer',
      status: 'pass',
      message: `Match ${input.matchId} is outside the SmartCup cutoff plus agent safety buffer.`,
      details,
    },
  };
}
