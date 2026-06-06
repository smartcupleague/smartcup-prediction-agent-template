import { AccountReadinessAdapter } from '../adapters/account-readiness.js';
import { BolaoChainClient } from '../adapters/bolao-chain-client.js';
import { FixtureAdapter } from '../adapters/fixture-adapter.js';
import { buildFreebetStatusReport } from '../freebet/index.js';
import { buildDecisionForMatch } from '../strategy/decision-workflow.js';
import { loadTournamentProfile, reconcileTournamentProfileWithChain } from '../tournament/index.js';
import type {
  AccountReadinessReport,
  ActorId,
  AgentConfig,
  DecisionReport,
  EligibleMatchPlan,
  FundingSource,
  RiskMode,
  U128String,
} from '../types/index.js';

export type OnboardingWizardStep = {
  key: 'wallet' | 'profile_terms' | 'freebet' | 'eligible_matches' | 'first_prediction';
  label: string;
  status: 'ready' | 'action_required' | 'blocked' | 'unknown';
  summary: string;
  details?: Record<string, unknown>;
};

export type OnboardingWizardReport = {
  generatedAt: string;
  wallet: ActorId;
  readiness: AccountReadinessReport;
  freebet: Awaited<ReturnType<typeof buildFreebetStatusReport>> | null;
  eligibleMatches: EligibleMatchPlan | null;
  firstPrediction: {
    selectedMatchId: string | null;
    fundingSource: FundingSource;
    decision: DecisionReport | null;
    notes: string[];
  };
  steps: OnboardingWizardStep[];
  nextActions: string[];
  warnings: string[];
};

export async function buildOnboardingWizardReport(
  config: AgentConfig,
  options: {
    wallet?: ActorId;
    matchId?: string | null;
    riskMode?: RiskMode;
    fundingSource?: FundingSource | 'auto';
    stakePlanck?: U128String;
    iterations?: number;
    candidateLimit?: number;
    profileLimit?: number;
    opponentLimit?: number;
    topScores?: number;
    seed?: string;
  } = {},
): Promise<OnboardingWizardReport> {
  const wallet = options.wallet ?? config.wallet.hexAddress;
  const warnings: string[] = [];
  const readiness = await new AccountReadinessAdapter(config).check();

  let freebet: Awaited<ReturnType<typeof buildFreebetStatusReport>> | null = null;
  try {
    freebet = await buildFreebetStatusReport(config, { wallet });
    warnings.push(...freebet.warnings);
  } catch (error) {
    warnings.push(`Freebet status failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let eligibleMatches: EligibleMatchPlan | null = null;
  try {
    const chain = new BolaoChainClient(config);
    const [state, userBets, profile] = await Promise.all([
      chain.queryState(),
      chain.queryBetsByUser(wallet),
      loadTournamentProfile(config.artifacts.tournamentProfilePath),
    ]);
    eligibleMatches = new FixtureAdapter().buildEligibleMatchPlan({
      wallet,
      matches: state.matches,
      userBets,
      profile: reconcileTournamentProfileWithChain(profile, state),
    });
  } catch (error) {
    warnings.push(`Eligible match planning failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fundingSource = resolveFundingSource(
    options.fundingSource ?? 'auto',
    freebet?.freebetLedger.betProgramAuthorized ?? null,
    freebet?.freebetLedger.balancePlanck ?? null,
  );
  const selectedMatchId = chooseMatchId(options.matchId ?? null, eligibleMatches);
  const firstPredictionNotes: string[] = [];
  let decision: DecisionReport | null = null;

  if (options.matchId && selectedMatchId !== options.matchId) {
    firstPredictionNotes.push(
      `Requested match ${options.matchId} is not currently eligible, so the wizard fell back to the next eligible match.`,
    );
  }

  if (selectedMatchId) {
    try {
      decision = await buildDecisionForMatch(config, selectedMatchId, {
        riskMode: options.riskMode ?? 'balanced',
        fundingSource,
        stakePlanck: options.stakePlanck ?? '4500000000000000',
        seed: options.seed ?? 'smartcup-agent',
        opponentLimit: options.opponentLimit ?? 500,
        profileLimit: options.profileLimit ?? 50,
        topScores: options.topScores ?? 8,
        iterations: options.iterations ?? 500,
        candidateLimit: options.candidateLimit ?? 8,
      });
    } catch (error) {
      firstPredictionNotes.push(
        `First-prediction recommendation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    firstPredictionNotes.push('No eligible open match is currently available for a first prediction recommendation.');
  }

  const steps = buildSteps(readiness, freebet, eligibleMatches, decision);
  const nextActions = buildNextActions(readiness, freebet, eligibleMatches, decision);

  return {
    generatedAt: new Date().toISOString(),
    wallet,
    readiness,
    freebet,
    eligibleMatches,
    firstPrediction: {
      selectedMatchId,
      fundingSource,
      decision,
      notes: firstPredictionNotes,
    },
    steps,
    nextActions,
    warnings,
  };
}

export function renderOnboardingWizardSummary(report: OnboardingWizardReport): string {
  const eligible = report.eligibleMatches?.eligibleMatches.length ?? 0;
  const ineligible = report.eligibleMatches?.ineligibleMatches.length ?? 0;
  const recommendation = report.firstPrediction.decision?.summary.recommendation ?? 'not available';

  return [
    `Wallet: ${report.wallet}`,
    `Read-only ready: ${report.readiness.readyForReadOnly ? 'yes' : 'no'}`,
    `Profile: ${report.readiness.smartcup.profile.displayName ?? 'missing display name'}`,
    `Terms localStorage key: ${report.readiness.smartcup.terms.localStorageKey}`,
    `Freebet funding: ${report.firstPrediction.fundingSource}`,
    `Freebet balance: ${report.freebet?.freebetLedger.balancePlanck ?? 'unknown'} planck`,
    `Eligible matches: ${eligible} (ineligible ${ineligible})`,
    `First prediction match: ${report.firstPrediction.selectedMatchId ?? 'none'}`,
    `Recommendation: ${recommendation}`,
    `Steps: ${report.steps.map((step) => `${step.key}=${step.status}`).join(', ')}`,
    ...report.firstPrediction.notes.map((note) => `Note: ${note}`),
    ...report.nextActions.map((action) => `Next: ${action}`),
    report.warnings.length ? `Warnings: ${report.warnings.join(' | ')}` : 'Warnings: none',
  ].join('\n');
}

function buildSteps(
  readiness: AccountReadinessReport,
  freebet: Awaited<ReturnType<typeof buildFreebetStatusReport>> | null,
  eligibleMatches: EligibleMatchPlan | null,
  decision: DecisionReport | null,
): OnboardingWizardStep[] {
  const walletReady =
    readiness.wallet.localWallet.status === 'ok' && readiness.wallet.balance.status !== 'error';
  const profileReady = readiness.smartcup.profile.status === 'ok';
  const termsKnown = readiness.smartcup.terms.status === 'ok';
  const freebetReady =
    freebet !== null &&
    freebet.freebetLedger.betProgramAuthorized === true &&
    BigInt(freebet.freebetLedger.balancePlanck ?? '0') > 0n;
  const eligibleCount = eligibleMatches?.eligibleMatches.length ?? 0;

  return [
    {
      key: 'wallet',
      label: 'Wallet and balance',
      status: walletReady ? 'ready' : 'blocked',
      summary: walletReady
        ? 'Local wallet exists and balance readback succeeded.'
        : 'Wallet presence or balance readback is blocking onboarding.',
    },
    {
      key: 'profile_terms',
      label: 'Profile and terms',
      status: profileReady ? (termsKnown ? 'ready' : 'unknown') : 'action_required',
      summary: profileReady
        ? 'SmartCup profile is present; terms still require frontend/local verification.'
        : 'Set or verify SmartCup profile details before relying on public identity.',
      details: {
        displayName: readiness.smartcup.profile.displayName ?? null,
        termsLocalStorageKey: readiness.smartcup.terms.localStorageKey,
      },
    },
    {
      key: 'freebet',
      label: 'Freebet readiness',
      status: freebetReady ? 'ready' : 'action_required',
      summary: freebetReady
        ? 'Freebet balance is available and BolaoCore is authorized.'
        : 'Freebet is unavailable, unauthorized, or not yet funded; cash staking may be required.',
    },
    {
      key: 'eligible_matches',
      label: 'Eligible matches',
      status: eligibleCount > 0 ? 'ready' : 'blocked',
      summary:
        eligibleCount > 0
          ? `${eligibleCount} eligible match(es) are open for prediction.`
          : 'No eligible open matches are currently available.',
    },
    {
      key: 'first_prediction',
      label: 'First prediction',
      status: decision ? 'ready' : eligibleCount > 0 ? 'action_required' : 'blocked',
      summary: decision
        ? `A first recommendation is ready for match ${decision.matchId}.`
        : 'No first-prediction recommendation is currently available.',
    },
  ];
}

function buildNextActions(
  readiness: AccountReadinessReport,
  freebet: Awaited<ReturnType<typeof buildFreebetStatusReport>> | null,
  eligibleMatches: EligibleMatchPlan | null,
  decision: DecisionReport | null,
): string[] {
  const actions: string[] = [];

  if (readiness.wallet.localWallet.status !== 'ok') {
    actions.push('Import or fix the local vara-wallet account before continuing.');
  }
  if (readiness.smartcup.profile.status !== 'ok') {
    actions.push('Open SmartCup with this wallet and set a display profile so the account is publicly recognizable.');
  }
  actions.push(
    `Open SmartCup in a browser and confirm terms acceptance is stored under ${readiness.smartcup.terms.localStorageKey}.`,
  );
  if (!freebet || freebet.freebetLedger.betProgramAuthorized !== true || BigInt(freebet.freebetLedger.balancePlanck ?? '0') === 0n) {
    actions.push('Plan for a cash-funded first prediction unless a freebet grant is added and authorized.');
  }
  if ((eligibleMatches?.eligibleMatches.length ?? 0) === 0) {
    actions.push('Wait for an open eligible match, then rerun onboarding.');
  }
  if (decision) {
    actions.push(`Review the recommendation for match ${decision.matchId}, then run submit with the saved decision if you want a plan.`);
  }
  return actions;
}

function chooseMatchId(requestedMatchId: string | null, eligibleMatches: EligibleMatchPlan | null): string | null {
  const eligible = eligibleMatches?.eligibleMatches ?? [];
  if (requestedMatchId && eligible.some((match) => String(match.matchId) === requestedMatchId)) return requestedMatchId;
  return eligible[0] ? String(eligible[0].matchId) : null;
}

function resolveFundingSource(
  requested: FundingSource | 'auto',
  authorized: boolean | null,
  balancePlanck: U128String | null,
): FundingSource {
  if (requested === 'cash' || requested === 'freebet') return requested;
  if (authorized === true && BigInt(balancePlanck ?? '0') > 0n) return 'freebet';
  return 'cash';
}
