import type {
  StoredTransactionPlan,
  StoredTransactionResult,
  TransactionSafetyCheck,
} from '../types/index.js';
import type { VaraUsdPriceSource } from '../economics/vara-usd-converter.js';
import { formatFriendlyPlanckAmount } from './friendly-money.js';
import { renderFriendlySourceWarningBullets } from './friendly-source-fallback-renderer.js';

export type FriendlyLiveExecutionPayload = {
  transactionPlan?: StoredTransactionPlan | null;
  transactionResult?: StoredTransactionResult | null;
  confirmationResult?: StoredTransactionResult | null;
};

export type FriendlyLiveExecutionOptions = {
  decisionId: string;
};

export function renderFriendlyLiveExecutionResult(
  payload: FriendlyLiveExecutionPayload,
  options: FriendlyLiveExecutionOptions,
): string {
  const plan = payload.transactionPlan ?? null;
  const result = payload.transactionResult ?? null;
  const confirmation = payload.confirmationResult ?? null;

  if (!plan) {
    return [
      'Approval result',
      '',
      `Saved decision: ${options.decisionId}`,
      'The agent could not load the stored transaction plan from the approval attempt.',
      '',
      'Next action',
      'Regenerate a fresh prediction preview, then approve from the saved decision button again.',
    ].join('\n');
  }

  return [
    'Approval result',
    '',
    renderTopLine(plan, result, confirmation),
    '',
    'Transaction plan',
    `- Plan id: ${plan.id}`,
    `- Kind: ${kindLabel(plan.kind)}`,
    `- Stored locally: yes`,
    `- Value attached: ${formatPlanValue(plan)}`,
    `- Requires explicit approval: ${plan.requiresApproval ? 'yes' : 'no'}`,
    '',
    'Safety gates',
    ...renderSafetyChecks(plan.safetyChecks),
    '',
    'Live submission',
    ...renderSubmission(plan, result),
    '',
    'Confirmation read-back',
    ...renderConfirmation(confirmation),
    '',
    'Next action',
    nextAction(plan, result, confirmation),
  ].join('\n');
}

function formatPlanValue(plan: StoredTransactionPlan): string {
  const price = priceFromSafetyChecks(plan.safetyChecks);
  if (price) return formatFriendlyPlanckAmount(plan.valuePlanck, price);
  const varaOnly = formatFriendlyPlanckAmount(plan.valuePlanck, null);
  if (plan.safetyChecks.some((check) => check.name === 'balance_and_exposure' && check.status === 'fail')) {
    return `${varaOnly}; USD snapshot was not stored because balance/exposure proof failed.`;
  }
  return varaOnly;
}

function priceFromSafetyChecks(checks: TransactionSafetyCheck[]): VaraUsdPriceSource | null {
  for (const check of checks) {
    const price = parseVaraUsdPrice(check.details?.price);
    if (price) return price;
  }
  return null;
}

function parseVaraUsdPrice(value: unknown): VaraUsdPriceSource | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const source = record.source === 'oracle' || record.source === 'bolao_state' ? record.source : null;
  const rawPrice = record.priceUsdMicro;
  if (!source || rawPrice === null || rawPrice === undefined) return null;
  try {
    const priceUsdMicro = BigInt(String(rawPrice));
    if (priceUsdMicro <= 0n) return null;
    return {
      source,
      priceUsdMicro,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    };
  } catch {
    return null;
  }
}

function renderTopLine(
  plan: StoredTransactionPlan,
  result: StoredTransactionResult | null,
  confirmation: StoredTransactionResult | null,
): string {
  if (confirmation?.status === 'confirmed') {
    return `${kindLabel(plan.kind)} was submitted and confirmed by read-back.`;
  }
  if (result?.status === 'submitted') {
    return `${kindLabel(plan.kind)} was submitted, but confirmation is still pending or inconclusive.`;
  }
  if (result?.status === 'submission_blocked' || plan.status === 'blocked') {
    return `${kindLabel(plan.kind)} was blocked before live submission.`;
  }
  if (result?.status === 'failed') {
    return `${kindLabel(plan.kind)} submit attempt failed.`;
  }
  return `${kindLabel(plan.kind)} plan was stored, but no live transaction was submitted.`;
}

function renderSafetyChecks(checks: TransactionSafetyCheck[]): string[] {
  if (checks.length === 0) return ['- No safety checks were recorded. Do not submit until this is investigated.'];
  return checks.map((check) => `- ${checkLabel(check.name)}: ${checkStatusLabel(check)}.`);
}

function renderSubmission(plan: StoredTransactionPlan, result: StoredTransactionResult | null): string[] {
  if (!result) return ['- No submit attempt was recorded.'];
  if (result.status === 'submitted') {
    return [
      '- Submit attempt: sent to Vara through the configured wallet account.',
      result.messageId ? `- Message id: ${result.messageId}` : null,
      result.txHash ? `- Transaction hash: ${result.txHash}` : null,
      result.blockNumber ? `- Block number: ${result.blockNumber}` : null,
    ].filter((line): line is string => line !== null);
  }
  if (result.status === 'submission_blocked') {
    return [
      '- Submit attempt: blocked before sending funds.',
      `- Reason: ${friendlyBlockedSubmissionReason(plan, result)}`,
    ];
  }
  if (result.status === 'not_submitted') {
    return [
      '- Submit attempt: not submitted.',
      `- Reason: ${friendlyResultReason(result)}`,
    ];
  }
  if (result.status === 'failed') {
    return [
      '- Submit attempt: failed after execution started.',
      `- Reason: ${friendlyResultReason(result)}`,
    ];
  }
  return [
    `- Submit attempt: ${result.status}.`,
    `- Reason: ${friendlyResultReason(result)}`,
  ];
}

function friendlyBlockedSubmissionReason(plan: StoredTransactionPlan, result: StoredTransactionResult): string {
  const failed = plan.safetyChecks.filter((check) => check.status === 'fail');
  const balanceExposureFailure = failed.find((check) => check.name === 'balance_and_exposure');
  if (balanceExposureFailure) {
    return balanceExposureBlockedSubmissionReason(balanceExposureFailure);
  }
  const duplicateFailure = failed.find((check) => check.name === 'duplicate_prediction');
  if (duplicateFailure) {
    return isDuplicateQueryFailure(duplicateFailure)
      ? 'Duplicate-prediction safety could not be proven because the wallet prediction read failed.'
      : 'This wallet already has a prediction for this match.';
  }
  if (failed.some((check) => check.name === 'cutoff_buffer')) {
    return 'Cutoff/timing safety could not be proven, or the match is too close to prediction close.';
  }
  if (failed.some((check) => check.name === 'place_bet_payload')) {
    return 'Prediction payload safety could not be proven for this match phase.';
  }
  if (failed.some((check) => check.name === 'policy_mode')) {
    return 'Operator policy blocked live execution.';
  }
  return friendlyResultReason(result);
}

function balanceExposureBlockedSubmissionReason(check: TransactionSafetyCheck): string {
  const reason = balanceExposureReason(check.message);
  const detail = balanceExposureDetail(check);
  const detailError = check.details && typeof check.details.error === 'string'
    ? ` Detail: ${shortDiagnostic(check.details.error)}`
    : '';
  return [
    'Balance/exposure safety could not be proven.',
    reason,
    detail,
    'The agent must prove wallet balance, max-stake cap, tournament exposure, and current wallet bets before sending funds.',
    detailError,
  ].filter(Boolean).join(' ').trim();
}

function balanceExposureDetail(check: TransactionSafetyCheck): string {
  const details = check.details ?? {};
  const pairs: string[] = [];
  const addPlanck = (label: string, key: string) => {
    const value = details[key];
    if (typeof value === 'string' && /^\d+$/.test(value)) pairs.push(`${label}: ${formatFriendlyPlanckAmount(value, null)}`);
  };
  addPlanck('Planned value', 'valuePlanck');
  addPlanck('Wallet free balance', 'freePlanck');
  addPlanck('Max stake', 'maxStakePlanck');
  addPlanck('Projected exposure', 'projectedExposurePlanck');
  addPlanck('Max exposure', 'maxTournamentExposurePlanck');
  return pairs.length > 0 ? `Proof snapshot: ${pairs.join('; ')}.` : '';
}

function renderConfirmation(result: StoredTransactionResult | null): string[] {
  if (!result) return ['- No confirmation read-back was needed or available.'];
  if (result.status === 'confirmed') {
    return ['- Confirmed: the post-submit read-back matched the expected wallet state.'];
  }
  if (result.status === 'unknown') {
    return [
      '- Not confirmed yet: the agent could not prove the on-chain state changed as expected.',
      `- Reason: ${friendlyResultReason(result)}`,
    ];
  }
  return [`- Confirmation status: ${result.status}.`, `- Reason: ${friendlyResultReason(result)}`];
}

function nextAction(
  plan: StoredTransactionPlan,
  result: StoredTransactionResult | null,
  confirmation: StoredTransactionResult | null,
): string {
  const failed = plan.safetyChecks.filter((check) => check.status === 'fail');
  const duplicateFailure = failed.find((check) => check.name === 'duplicate_prediction');
  if (duplicateFailure) {
    return isDuplicateQueryFailure(duplicateFailure)
      ? 'Retry only after checking Data Provider Status or rerunning the saved report; the agent could not prove duplicate safety.'
      : 'Do not retry. This wallet already has a prediction for the match.';
  }
  if (failed.some((check) => check.name === 'cutoff_buffer')) {
    return 'Do not retry unless a fresh live timing check proves the match is outside the cutoff/safety window.';
  }
  if (failed.some((check) => check.name === 'balance_and_exposure' || check.name === 'freebet_readiness')) {
    return 'Adjust stake/exposure or funding source, then regenerate a fresh prediction preview before approving again.';
  }
  if (failed.some((check) => check.name === 'policy_mode')) {
    return 'Change Operator Policy only if you intentionally want live execution, then regenerate and approve a fresh plan.';
  }
  if (result?.status === 'failed') {
    return 'Do not retry blindly. Re-query wallet predictions/status first, then regenerate a fresh plan if needed.';
  }
  if (result?.status === 'submitted' && confirmation?.status !== 'confirmed') {
    return 'Do not submit again yet. Check SmartCup/chain state first to avoid accidental duplicate execution.';
  }
  if (confirmation?.status === 'confirmed') {
    return 'No further action needed for this transaction. Use Agent Status or Prediction History to review progress.';
  }
  return 'No live transaction was sent. Review the blocked gate above before trying again.';
}

function checkStatusLabel(check: TransactionSafetyCheck): string {
  if (check.status === 'pass') return 'passed';
  if (check.status === 'not_evaluated') return 'not checked yet; approval must not continue';
  if (check.name === 'policy_mode') return policyBlockReason(check.message);
  if (check.name === 'duplicate_prediction') return duplicateReason(check.message);
  if (check.name === 'cutoff_buffer') return cutoffReason(check.message);
  if (check.name === 'balance_and_exposure') return balanceExposureReason(check.message);
  if (check.name === 'freebet_readiness') return freebetReason(check.message);
  if (check.name === 'place_bet_payload') return payloadReason(check.message);
  if (check.name === 'claim_eligibility') return claimReason(check.message);
  return sanitizedCheckMessage(check.message);
}

function friendlyResultReason(result: StoredTransactionResult): string {
  const error = result.error ?? '';
  const diagnostic = executionDiagnostic(result);
  const specific = specificExecutionReason(diagnostic);
  if (specific) return specific;
  const warnings = renderFriendlySourceWarningBullets([diagnostic], 1);
  if (warnings[0]) return warnings[0];
  if (/read_only/i.test(error)) return 'Operator Policy is Read Only, so live wallet execution is blocked.';
  if (/approval_required.*explicit approval|explicit approval/i.test(error)) {
    return 'Approval Required mode needs an explicit approval action before funds can move.';
  }
  if (/failed safety checks/i.test(error)) return 'One or more safety gates failed before submission.';
  if (/not-evaluated safety checks/i.test(error)) return 'Some safety gates were not checked, so execution stayed blocked.';
  if (/transaction submitted|plan stored/i.test(error)) return 'Plan storage completed.';
  if (!error) return 'No additional reason recorded.';
  return 'The executor returned a guarded failure. Review Data Provider Status and rerun a fresh plan before retrying.';
}

function executionDiagnostic(result: StoredTransactionResult): string {
  const parts = [result.error, stringPayload(result.payload?.stderr), stringPayload(result.payload?.stdout)]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim());
  return parts.join('\n');
}

function stringPayload(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function specificExecutionReason(diagnostic: string): string | null {
  if (!diagnostic) return null;
  if (/insufficient|not enough|balance too low|cannot withdraw|existential/i.test(diagnostic)) {
    return 'Wallet execution failed because available balance, existential deposit, gas, or attached value was not sufficient for the live call.';
  }
  if (/revert|reverted|extrinsicfailed|moduleerror|contracttrapped|panic|execution ran out of gas/i.test(diagnostic)) {
    return `BolaoCore rejected the live call. Detail: ${shortDiagnostic(diagnostic)}`;
  }
  if (/timeout|timed out|operation was aborted|aborted/i.test(diagnostic)) {
    return 'The wallet command timed out before the agent could prove whether the transaction landed. Check wallet predictions/status before retrying.';
  }
  if (/account.*(not found|missing|unknown)|wallet.*account|keyring/i.test(diagnostic)) {
    return 'The configured vara-wallet signing account was not available on this deployment. Import or mount the agent wallet account before live execution.';
  }
  if (/no such file|enoent|permission denied/i.test(diagnostic)) {
    return 'The configured vara-wallet executable could not be run on this deployment. Check Render build/runtime configuration.';
  }
  if (/idl|decode|encode|payload|variant|method/i.test(diagnostic)) {
    return `Wallet or IDL encoding failed for this contract call. Detail: ${shortDiagnostic(diagnostic)}`;
  }
  if (/rpc|websocket|network|transport|connection|querybetsbyuser|querystate|querymatch/i.test(diagnostic)) {
    return 'The wallet or chain RPC failed during execution/readback. Re-query wallet predictions/status before retrying.';
  }
  return null;
}

function shortDiagnostic(diagnostic: string): string {
  return sanitizedCheckMessage(diagnostic)
    .replace(/\s+/g, ' ')
    .slice(0, 260)
    .trim();
}

function policyBlockReason(message: string): string {
  if (/read_only/i.test(message)) return 'blocked because Operator Policy is Read Only.';
  if (/claim_only/i.test(message)) return 'blocked because Claim Only mode does not allow new prediction submissions.';
  if (/approval_required/i.test(message)) return 'passed; explicit approval is still required before live submission.';
  if (/tournament_autopilot/i.test(message)) return 'blocked until autopilot readiness and live smoke verification are complete.';
  return sanitizedCheckMessage(message);
}

function duplicateReason(message: string): string {
  if (/already has a prediction/i.test(message)) return 'blocked because this wallet already has a prediction for this match.';
  if (/query failed/i.test(message)) return 'blocked because duplicate safety could not be proven.';
  return sanitizedCheckMessage(message);
}

function isDuplicateQueryFailure(check: TransactionSafetyCheck): boolean {
  const message = check.message.toLowerCase();
  return message.includes('query failed') || message.includes('could not be proven');
}

function cutoffReason(message: string): string {
  if (/cutoff|timing|safety/i.test(message)) return 'blocked because timing/cutoff safety could not be proven or the match is too close.';
  return sanitizedCheckMessage(message);
}

function balanceExposureReason(message: string): string {
  if (/minimum stake|below.*stake|stake.*below/i.test(message)) {
    return 'blocked because the planned stake is below the configured SmartCup minimum stake.';
  }
  if (/exceeds configured max-stake/i.test(message)) return 'blocked because the planned stake exceeds the configured max-stake cap.';
  if (/projected tournament exposure exceeds/i.test(message)) return 'blocked because the projected tournament exposure exceeds the configured max-exposure cap.';
  if (/wallet free balance is lower/i.test(message)) return 'blocked because wallet free balance is lower than the planned attached value.';
  if (/guard failed|spending safety could not be proven/i.test(message)) return 'blocked because the balance/exposure proof query failed before a specific cap or balance comparison could be trusted.';
  return sanitizedCheckMessage(message);
}

function freebetReason(message: string): string {
  if (/does not authorize/i.test(message)) return 'blocked because the Freebet Ledger does not authorize this BolaoCore.';
  if (/balance is lower/i.test(message)) return 'blocked because freebet balance is lower than the planned amount.';
  if (/query failed/i.test(message)) return 'blocked because freebet authorization or balance could not be proven.';
  return sanitizedCheckMessage(message);
}

function payloadReason(message: string): string {
  if (/penalty-winner|phase|payload/i.test(message)) {
    return 'blocked because score/penalty-winner payload safety could not be proven for this match phase.';
  }
  return sanitizedCheckMessage(message);
}

function claimReason(message: string): string {
  if (/no pending refund/i.test(message)) return 'blocked because no pending refund is claimable right now.';
  if (/readback failed/i.test(message)) return 'blocked because claim eligibility could not be proven.';
  return sanitizedCheckMessage(message);
}

function sanitizedCheckMessage(message: string): string {
  const warnings = renderFriendlySourceWarningBullets([message], 1);
  if (warnings[0]) return warnings[0];
  return message
    .replace(/0x[a-fA-F0-9]{16,}/g, 'wallet/program id')
    .replace(/\b\d{10,}\s*planck\b/gi, 'a VARA-denominated amount')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkLabel(name: string): string {
  if (name === 'policy_mode') return 'Operator policy';
  if (name === 'duplicate_prediction') return 'Duplicate prediction';
  if (name === 'place_bet_payload') return 'Prediction payload';
  if (name === 'cutoff_buffer') return 'Cutoff buffer';
  if (name === 'balance_and_exposure') return 'Balance and exposure';
  if (name === 'freebet_readiness') return 'Freebet readiness';
  if (name === 'claim_eligibility') return 'Claim eligibility';
  return name.replace(/_/g, ' ');
}

function kindLabel(kind: string): string {
  if (kind === 'PlaceBet') return 'PlaceBet prediction';
  if (kind === 'SpendFreebet') return 'Freebet prediction';
  if (kind === 'SubmitPodiumPick') return 'Podium pick';
  if (kind === 'ClaimMatchReward') return 'Match reward claim';
  if (kind === 'ClaimRefund') return 'Refund claim';
  if (kind === 'ClaimFinalPrize') return 'Final prize claim';
  return kind;
}
