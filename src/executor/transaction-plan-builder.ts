import type {
  AgentConfig,
  DecisionReport,
  HexAddress,
  PenaltyWinner,
  RiskMode,
  Score,
  StoredTransactionPlan,
  TransactionKind,
  TransactionPlanStatus,
  TransactionSafetyCheck,
  U128String,
} from '../types/index.js';
import { resolveFreebetLedgerProgramId } from '../freebet/freebet-ledger-resolver.js';
import { evaluateAutopilotReadiness } from './autopilot-readiness.js';

export type PlaceBetPlanInput = {
  decision: DecisionReport;
  scoreOverride?: Score | null;
  penaltyWinnerOverride?: PenaltyWinner | null;
  valuePlanckOverride?: U128String | null;
};

export type SubmitPodiumPickPlanInput = {
  champion: string;
  runnerUp: string;
  thirdPlace: string;
  valuePlanck: U128String;
  riskMode?: RiskMode | null;
  decisionId?: string | null;
};

export type ClaimMatchRewardPlanInput = {
  matchId: number;
};

export type ClaimFinalPrizePlanInput = {
  decisionId?: string | null;
};

export type ClaimRefundPlanInput = {
  decisionId?: string | null;
};

export type SpendFreebetPlanInput = {
  decision: DecisionReport;
  scoreOverride?: Score | null;
  penaltyWinnerOverride?: PenaltyWinner | null;
  amountPlanckOverride?: U128String | null;
};

type BasePlanInput = {
  kind: TransactionKind;
  programId: HexAddress;
  method: string;
  idlPath: string;
  args: unknown[];
  valuePlanck: U128String;
  riskMode: RiskMode | null;
  decisionId: string | null;
  summary: string;
  payload: Record<string, unknown>;
};

type PolicyGateDecision = {
  status: TransactionPlanStatus;
  requiresApproval: boolean;
  check: TransactionSafetyCheck;
  action: 'block' | 'manual_approval_required' | 'autopilot_allowed' | 'claim_allowed';
};

export function buildPlaceBetTransactionPlan(
  config: AgentConfig,
  input: PlaceBetPlanInput,
): StoredTransactionPlan {
  const { decision } = input;
  const score = input.scoreOverride ?? decision.selected.score;
  const penaltyWinner = input.penaltyWinnerOverride ?? decision.selected.penaltyWinner;
  const valuePlanck = input.valuePlanckOverride ?? decision.economics.stakePlanck;
  validatePlanck(valuePlanck, 'PlaceBet value override');
  return buildTransactionPlan(config, {
    kind: 'PlaceBet',
    programId: config.programs.bolaoCore,
    method: 'Service/PlaceBet',
    idlPath: config.artifacts.bolaoIdlPath,
    args: [decision.matchId, score, penaltyWinner],
    valuePlanck,
    riskMode: decision.riskMode,
    decisionId: decision.id,
    summary: input.scoreOverride
      ? `PlaceBet manual score ${decision.match.home} ${score.home}-${score.away} ${decision.match.away} for match ${decision.matchId}`
      : `PlaceBet ${decision.summary.recommendation} for match ${decision.matchId}`,
    payload: {
      decisionSummary: decision.summary,
      selected: {
        ...decision.selected,
        score,
        outcome: scoreOutcome(score),
        penaltyWinner,
        source: input.scoreOverride ? 'operator_manual_override' : 'agent_recommendation',
      },
      economics: {
        ...decision.economics,
        stakePlanck: valuePlanck,
        userCapitalAtRiskPlanck: valuePlanck,
        stakeOverrideSource: input.valuePlanckOverride ? 'operator_value_override' : null,
      },
      varaWalletSyntax:
        'vara-wallet call <bolao_core_program_id> Service/PlaceBet --args \'[match_id,{"home":home,"away":away},penalty_winner]\' --value <stake_planck> --units raw --idl artifacts/idl/bolao_program.idl',
    },
  });
}

export function buildSpendFreebetTransactionPlan(
  config: AgentConfig,
  input: SpendFreebetPlanInput,
): StoredTransactionPlan {
  const { decision } = input;
  const score = input.scoreOverride ?? decision.selected.score;
  const penaltyWinner = input.penaltyWinnerOverride ?? decision.selected.penaltyWinner;
  const freebetAmountPlanck = input.amountPlanckOverride ?? decision.economics.stakePlanck;
  const ledgerResolution = resolveFreebetLedgerProgramId(config, {
    decisionChainLedgerId: decision.sourceSnapshots.chain.freebetLedgerProgramId,
  });
  const ledgerProgramId = ledgerResolution.programId;

  if (!ledgerProgramId) {
    throw new Error(
      'SpendFreebet requires a configured or discovered Freebet Ledger program id. Set SMARTCUP_FREEBET_LEDGER_ID, refresh the decision from live state, or set programs.freebetLedger in the tournament profile.',
    );
  }

  validatePlanck(freebetAmountPlanck, 'freebet amount');

  return buildTransactionPlan(config, {
    kind: 'SpendFreebet',
    programId: ledgerProgramId,
    method: 'FreebetLedger/SpendFreebet',
    idlPath: config.artifacts.freebetLedgerIdlPath,
    args: [
      config.programs.bolaoCore,
      decision.matchId,
      freebetAmountPlanck,
      score,
      penaltyWinner,
    ],
    valuePlanck: '0',
    riskMode: decision.riskMode,
    decisionId: decision.id,
    summary: input.scoreOverride
      ? `SpendFreebet manual score ${decision.match.home} ${score.home}-${score.away} ${decision.match.away} for match ${decision.matchId}`
      : `SpendFreebet ${decision.summary.recommendation} for match ${decision.matchId}`,
    payload: {
      decisionSummary: decision.summary,
      selected: {
        ...decision.selected,
        score,
        outcome: scoreOutcome(score),
        penaltyWinner,
        source: input.scoreOverride ? 'operator_manual_override' : 'agent_recommendation',
      },
      economics: decision.economics,
      fundingSource: decision.economics.fundingSource,
      freebetAmountPlanck,
      freebetLedgerSource: ledgerResolution.source,
      amountOverrideSource: input.amountPlanckOverride ? 'operator_value_override' : null,
      varaWalletSyntax:
        'vara-wallet call <freebet_ledger_program_id> FreebetLedger/SpendFreebet --args \'[<bolao_core_program_id>,match_id,amount_planck,{"home":home,"away":away},penalty_winner]\' --value 0 --units raw --idl artifacts/idl/freebet-ledger.idl',
    },
  });
}

function scoreOutcome(score: Score): 'home' | 'draw' | 'away' {
  if (score.home > score.away) return 'home';
  if (score.home < score.away) return 'away';
  return 'draw';
}

export function buildSubmitPodiumPickTransactionPlan(
  config: AgentConfig,
  input: SubmitPodiumPickPlanInput,
): StoredTransactionPlan {
  validateNonEmpty(input.champion, 'champion');
  validateNonEmpty(input.runnerUp, 'runnerUp');
  validateNonEmpty(input.thirdPlace, 'thirdPlace');
  validatePlanck(input.valuePlanck, 'valuePlanck');
  return buildTransactionPlan(config, {
    kind: 'SubmitPodiumPick',
    programId: config.programs.bolaoCore,
    method: 'Service/SubmitPodiumPick',
    idlPath: config.artifacts.bolaoIdlPath,
    args: [input.champion, input.runnerUp, input.thirdPlace],
    valuePlanck: input.valuePlanck,
    riskMode: input.riskMode ?? null,
    decisionId: input.decisionId ?? null,
    summary: `SubmitPodiumPick champion=${input.champion}, runner_up=${input.runnerUp}, third_place=${input.thirdPlace}`,
    payload: {
      podiumPick: {
        champion: input.champion,
        runnerUp: input.runnerUp,
        thirdPlace: input.thirdPlace,
      },
      varaWalletSyntax:
        'vara-wallet call <bolao_core_program_id> Service/SubmitPodiumPick --args \'["Champion","Runner Up","Third Place"]\' --value <stake_planck> --units raw --idl artifacts/idl/bolao_program.idl',
    },
  });
}

export function buildClaimMatchRewardTransactionPlan(
  config: AgentConfig,
  input: ClaimMatchRewardPlanInput,
): StoredTransactionPlan {
  if (!Number.isSafeInteger(input.matchId) || input.matchId <= 0) {
    throw new Error(`Invalid match id: ${input.matchId}`);
  }
  return buildTransactionPlan(config, {
    kind: 'ClaimMatchReward',
    programId: config.programs.bolaoCore,
    method: 'Service/ClaimMatchReward',
    idlPath: config.artifacts.bolaoIdlPath,
    args: [input.matchId],
    valuePlanck: '0',
    riskMode: null,
    decisionId: null,
    summary: `ClaimMatchReward for match ${input.matchId}`,
    payload: {
      matchId: input.matchId,
      varaWalletSyntax:
        'vara-wallet call <bolao_core_program_id> Service/ClaimMatchReward --args \'[match_id]\' --value 0 --units raw --idl artifacts/idl/bolao_program.idl',
    },
  });
}

export function buildClaimFinalPrizeTransactionPlan(
  config: AgentConfig,
  input: ClaimFinalPrizePlanInput = {},
): StoredTransactionPlan {
  return buildTransactionPlan(config, {
    kind: 'ClaimFinalPrize',
    programId: config.programs.bolaoCore,
    method: 'Service/ClaimFinalPrize',
    idlPath: config.artifacts.bolaoIdlPath,
    args: [],
    valuePlanck: '0',
    riskMode: null,
    decisionId: input.decisionId ?? null,
    summary: 'ClaimFinalPrize',
    payload: {
      varaWalletSyntax:
        'vara-wallet call <bolao_core_program_id> Service/ClaimFinalPrize --args \'[]\' --value 0 --units raw --idl artifacts/idl/bolao_program.idl',
    },
  });
}

export function buildClaimRefundTransactionPlan(
  config: AgentConfig,
  input: ClaimRefundPlanInput = {},
): StoredTransactionPlan {
  return buildTransactionPlan(config, {
    kind: 'ClaimRefund',
    programId: config.programs.bolaoCore,
    method: 'Service/ClaimRefund',
    idlPath: config.artifacts.bolaoIdlPath,
    args: [],
    valuePlanck: '0',
    riskMode: null,
    decisionId: input.decisionId ?? null,
    summary: 'ClaimRefund',
    payload: {
      varaWalletSyntax:
        'vara-wallet call <bolao_core_program_id> Service/ClaimRefund --args \'[]\' --value 0 --units raw --idl artifacts/idl/bolao_program.idl',
    },
  });
}

function buildTransactionPlan(config: AgentConfig, input: BasePlanInput): StoredTransactionPlan {
  validatePlanck(input.valuePlanck, 'valuePlanck');
  const createdAt = new Date().toISOString();
  const policyGate = buildPolicyGate(config, input.kind);
  const safetyChecks = buildInitialSafetyChecks(input.kind, policyGate.check);

  return {
    id: `txplan-${input.kind}-${input.decisionId ?? 'manual'}-${createdAt.replace(/[:.]/g, '-')}`,
    createdAt,
    updatedAt: createdAt,
    decisionId: input.decisionId,
    kind: input.kind,
    status: policyGate.status,
    wallet: config.wallet.hexAddress,
    programId: input.programId,
    method: input.method,
    args: input.args,
    valuePlanck: input.valuePlanck,
    riskMode: input.riskMode,
    requiresApproval: policyGate.requiresApproval,
    safetyChecks,
    summary: input.summary,
    payload: {
      ...input.payload,
      policyGate: {
        mode: config.policy.mode,
        action: policyGate.action,
        requiresApproval: policyGate.requiresApproval,
      },
      command: buildVaraWalletCommand(config, input.programId, input.method, input.args, input.valuePlanck, input.idlPath),
      note: 'Storage-only plan. This command does not submit transactions.',
    },
  };
}

function buildPolicyGate(config: AgentConfig, kind: TransactionKind): PolicyGateDecision {
  const details = { mode: config.policy.mode, kind };

  if (config.policy.mode === 'read_only') {
    return {
      status: 'blocked',
      requiresApproval: true,
      action: 'block',
      check: {
        name: 'policy_mode',
        status: 'fail',
        message: `Policy mode read_only blocks all transaction execution, including ${kind}.`,
        details,
      },
    };
  }

  if (config.policy.mode === 'claim_only') {
    const claim = kind === 'ClaimMatchReward' || kind === 'ClaimRefund' || kind === 'ClaimFinalPrize';
    return {
      status: claim ? 'planned' : 'blocked',
      requiresApproval: !claim,
      action: claim ? 'claim_allowed' : 'block',
      check: {
        name: 'policy_mode',
        status: claim ? 'pass' : 'fail',
        message: claim
          ? `Policy mode claim_only allows ${kind} after claim eligibility readback passes.`
          : `Policy mode claim_only blocks prediction writes such as ${kind}.`,
        details,
      },
    };
  }

  if (config.policy.mode === 'approval_required') {
    return {
      status: 'planned',
      requiresApproval: true,
      action: 'manual_approval_required',
      check: {
        name: 'policy_mode',
        status: 'pass',
        message: `Policy mode approval_required allows ${kind} planning, but execution must wait for explicit approval.`,
        details,
      },
    };
  }

  const readiness = evaluateAutopilotReadiness(config);
  if (!readiness.ready) {
    return {
      status: 'blocked',
      requiresApproval: true,
      action: 'block',
      check: {
        name: 'policy_mode',
        status: 'fail',
        message:
          `Policy mode tournament_autopilot is blocked until approval flow and live smoke verification are recorded.`,
        details: {
          ...details,
          autopilotReadiness: readiness.details,
          missing: readiness.missing,
        },
      },
    };
  }

  return {
    status: 'planned',
    requiresApproval: false,
    action: 'autopilot_allowed',
    check: {
      name: 'policy_mode',
      status: 'pass',
      message: `Policy mode tournament_autopilot allows ${kind} only after all remaining safety guards pass.`,
      details,
    },
  };
}

function buildInitialSafetyChecks(kind: TransactionKind, policyCheck: TransactionSafetyCheck): TransactionSafetyCheck[] {
  const checks: TransactionSafetyCheck[] = [policyCheck];

  if (kind === 'PlaceBet' || kind === 'SpendFreebet') {
    checks.push(
      {
        name: 'duplicate_prediction',
        status: 'not_evaluated',
        message: `Duplicate prediction validation runs before a ${kind} plan is stored when policy allows writes.`,
      },
      {
        name: 'place_bet_payload',
        status: 'not_evaluated',
        message: `${kind} score and penalty-winner payload validation is deferred until live match phase readback.`,
      },
      {
        name: 'cutoff_buffer',
        status: 'not_evaluated',
        message: 'Cutoff buffer validation is deferred to Phase 6 guarded executor.',
      },
    );

    if (kind === 'PlaceBet') {
      checks.push({
        name: 'balance_and_exposure',
        status: 'not_evaluated',
        message: 'Balance and exposure validation is deferred to Phase 6 guarded executor.',
      });
    }

    if (kind === 'SpendFreebet') {
      checks.push({
        name: 'freebet_readiness',
        status: 'not_evaluated',
        message: 'Freebet balance and bet-program authorization validation is deferred to the guarded executor.',
      });
    }
  } else if (kind === 'SubmitPodiumPick') {
    checks.push(
      {
        name: 'podium_pick_payload',
        status: 'not_evaluated',
        message: 'Podium pick payload validation is deferred to the guarded executor.',
      },
      {
        name: 'podium_timing',
        status: 'not_evaluated',
        message: 'Podium pick timing validation is deferred to live tournament state readback.',
      },
      {
        name: 'balance_and_exposure',
        status: 'not_evaluated',
        message: 'Balance and exposure validation is deferred to Phase 6 guarded executor.',
      },
    );
  } else {
    checks.push({
      name: 'claim_eligibility',
      status: 'not_evaluated',
      message: 'Claim eligibility readback is deferred to Phase 6 guarded executor.',
    });
  }

  return checks;
}

function buildVaraWalletCommand(
  config: AgentConfig,
  programId: HexAddress,
  method: string,
  args: unknown[],
  valuePlanck: U128String,
  idlPath: string,
): string[] {
  return [
    'npm',
    'exec',
    '--yes',
    '--package=vara-wallet',
    '--',
    'vara-wallet',
    '--ws',
    config.network.rpcUrl,
    '--json',
    '--account',
    config.wallet.accountName,
    'call',
    programId,
    method,
    '--args',
    JSON.stringify(args),
    '--value',
    valuePlanck,
    '--units',
    'raw',
    '--idl',
    idlPath,
  ];
}

function validateNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} cannot be empty.`);
}

function validatePlanck(value: string, label: string): void {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a non-negative planck integer string.`);
}
