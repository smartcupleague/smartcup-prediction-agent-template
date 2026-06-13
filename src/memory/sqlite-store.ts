import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { jsonStringify } from './json-safe.js';
import type {
  DecisionReport,
  StoredOutcomeEvaluation,
  StoredPrediction,
  StoredParserTelemetry,
  StoredRuntimePolicy,
  StoredTelegramPredictionAlert,
  StoredTelegramPreference,
  StoredTransactionPlan,
  StoredTransactionResult,
} from '../types/index.js';

const DEFAULT_SQLITE_PATH = 'data/smartcup-agent.memory.sqlite';

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_memory_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS predictions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        match_id TEXT NOT NULL,
        predicted_outcome TEXT NOT NULL,
        created_at TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_source ON predictions(source);
      CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at);

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL,
        match_id TEXT NOT NULL,
        risk_mode TEXT NOT NULL,
        selected_home INTEGER NOT NULL,
        selected_away INTEGER NOT NULL,
        selected_outcome TEXT NOT NULL,
        utility REAL NOT NULL,
        confidence REAL NOT NULL,
        model_versions_json TEXT NOT NULL,
        source_warnings_json TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_match_id ON decisions(match_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_risk_mode ON decisions(risk_mode);
      CREATE INDEX IF NOT EXISTS idx_decisions_generated_at ON decisions(generated_at);
    `,
  },
  {
    version: 2,
    name: 'transaction_audit_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS transaction_plans (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        decision_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        wallet TEXT NOT NULL,
        program_id TEXT NOT NULL,
        method TEXT NOT NULL,
        value_planck TEXT NOT NULL,
        risk_mode TEXT,
        requires_approval INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_plans_decision_id ON transaction_plans(decision_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_plans_kind ON transaction_plans(kind);
      CREATE INDEX IF NOT EXISTS idx_transaction_plans_status ON transaction_plans(status);
      CREATE INDEX IF NOT EXISTS idx_transaction_plans_created_at ON transaction_plans(created_at);

      CREATE TABLE IF NOT EXISTS transaction_results (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        message_id TEXT,
        block_hash TEXT,
        block_number TEXT,
        error TEXT,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES transaction_plans(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transaction_results_plan_id ON transaction_results(plan_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_results_status ON transaction_results(status);
      CREATE INDEX IF NOT EXISTS idx_transaction_results_created_at ON transaction_results(created_at);
    `,
  },
  {
    version: 3,
    name: 'outcome_evaluation_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS outcome_evaluations (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        actual_result_status TEXT NOT NULL,
        awarded_weighted_points REAL,
        payout_status TEXT NOT NULL,
        amount_claimable_planck TEXT,
        error_classification TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_decision_id ON outcome_evaluations(decision_id);
      CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_match_id ON outcome_evaluations(match_id);
      CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_status ON outcome_evaluations(status);
      CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_error_classification ON outcome_evaluations(error_classification);
      CREATE INDEX IF NOT EXISTS idx_outcome_evaluations_evaluated_at ON outcome_evaluations(evaluated_at);
    `,
  },
  {
    version: 7,
    name: 'parser_telemetry_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS parser_telemetry (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        transport TEXT NOT NULL,
        raw_text_hash TEXT NOT NULL,
        raw_text_length INTEGER NOT NULL,
        chat_hash TEXT,
        user_hash TEXT,
        parsed_intent TEXT NOT NULL,
        parsed_permission TEXT NOT NULL,
        parsed_safety TEXT NOT NULL,
        confidence REAL NOT NULL,
        action_taken TEXT NOT NULL,
        safety_outcome TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_parser_telemetry_created_at ON parser_telemetry(created_at);
      CREATE INDEX IF NOT EXISTS idx_parser_telemetry_intent ON parser_telemetry(parsed_intent);
      CREATE INDEX IF NOT EXISTS idx_parser_telemetry_action ON parser_telemetry(action_taken);
      CREATE INDEX IF NOT EXISTS idx_parser_telemetry_safety_outcome ON parser_telemetry(safety_outcome);
      CREATE INDEX IF NOT EXISTS idx_parser_telemetry_raw_text_hash ON parser_telemetry(raw_text_hash);
    `,
  },
  {
    version: 8,
    name: 'telegram_preference_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_preferences (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        role TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        tournament_id TEXT NOT NULL,
        default_risk_mode TEXT NOT NULL,
        simulation_objective TEXT NOT NULL,
        strategy_posture TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_preferences_scope
        ON telegram_preferences(subject_id, tournament_id, role);
      CREATE INDEX IF NOT EXISTS idx_telegram_preferences_subject_hash
        ON telegram_preferences(subject_hash);
      CREATE INDEX IF NOT EXISTS idx_telegram_preferences_tournament
        ON telegram_preferences(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_telegram_preferences_updated_at
        ON telegram_preferences(updated_at);
    `,
  },
  {
    version: 9,
    name: 'runtime_policy_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS runtime_policies (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_by TEXT,
        startup_env_mode TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_policies_updated_at
        ON runtime_policies(updated_at);
      CREATE INDEX IF NOT EXISTS idx_runtime_policies_mode
        ON runtime_policies(mode);
    `,
  },
  {
    version: 10,
    name: 'telegram_prediction_alert_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS telegram_prediction_alerts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        tournament_id TEXT NOT NULL,
        match_id TEXT NOT NULL,
        alert_lead_minutes INTEGER NOT NULL,
        prediction_cutoff_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_prediction_alerts_once
        ON telegram_prediction_alerts(chat_id, tournament_id, match_id, alert_lead_minutes);
      CREATE INDEX IF NOT EXISTS idx_telegram_prediction_alerts_sent_at
        ON telegram_prediction_alerts(sent_at);
      CREATE INDEX IF NOT EXISTS idx_telegram_prediction_alerts_tournament
        ON telegram_prediction_alerts(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_telegram_prediction_alerts_match
        ON telegram_prediction_alerts(match_id);
    `,
  },
];

type JsonPayloadRow = {
  payload_json: string;
};

export class SqliteMemoryStore {
  private readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path = DEFAULT_SQLITE_PATH) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
    this.migrate();
  }

  getPath(): string {
    return this.path;
  }

  importSnapshot(snapshot: {
    predictions: StoredPrediction[];
    reports: DecisionReport[];
    transactionPlans?: StoredTransactionPlan[];
    transactionResults?: StoredTransactionResult[];
    outcomeEvaluations?: StoredOutcomeEvaluation[];
    parserTelemetry?: StoredParserTelemetry[];
    telegramPreferences?: StoredTelegramPreference[];
    runtimePolicies?: StoredRuntimePolicy[];
    telegramPredictionAlerts?: StoredTelegramPredictionAlert[];
  }): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const prediction of snapshot.predictions) this.savePrediction(prediction);
      for (const report of snapshot.reports) this.saveDecision(report);
      for (const plan of snapshot.transactionPlans ?? []) this.saveTransactionPlan(plan);
      for (const result of snapshot.transactionResults ?? []) this.saveTransactionResult(result);
      for (const evaluation of snapshot.outcomeEvaluations ?? []) this.saveOutcomeEvaluation(evaluation);
      for (const entry of snapshot.parserTelemetry ?? []) this.saveParserTelemetry(entry);
      for (const preference of snapshot.telegramPreferences ?? []) this.saveTelegramPreference(preference);
      for (const policy of snapshot.runtimePolicies ?? []) this.saveRuntimePolicy(policy);
      for (const alert of snapshot.telegramPredictionAlerts ?? []) this.saveTelegramPredictionAlert(alert);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  savePrediction(prediction: StoredPrediction): void {
    this.db
      .prepare(
        `
          INSERT INTO predictions (
            id,
            source,
            wallet_address,
            match_id,
            predicted_outcome,
            created_at,
            imported_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            source = excluded.source,
            wallet_address = excluded.wallet_address,
            match_id = excluded.match_id,
            predicted_outcome = excluded.predicted_outcome,
            created_at = excluded.created_at,
            imported_at = excluded.imported_at,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        prediction.id,
        prediction.source,
        prediction.walletAddress,
        prediction.matchId,
        prediction.predictedOutcome,
        prediction.createdAt,
        prediction.importedAt,
        jsonStringify(prediction),
      );
  }

  savePredictions(predictions: StoredPrediction[]): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const prediction of predictions) this.savePrediction(prediction);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  listPredictions(): StoredPrediction[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM predictions ORDER BY created_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredPrediction);
  }

  deletePredictionsForWalletSources(
    walletAddress: StoredPrediction['walletAddress'],
    sources: StoredPrediction['source'][],
  ): void {
    if (sources.length === 0) return;
    const placeholders = sources.map(() => '?').join(', ');
    this.db
      .prepare(
        `
          DELETE FROM predictions
          WHERE wallet_address = ?
            AND source IN (${placeholders})
        `,
      )
      .run(walletAddress, ...sources);
  }

  replacePredictionsForWalletSources(
    walletAddress: StoredPrediction['walletAddress'],
    sources: StoredPrediction['source'][],
    predictions: StoredPrediction[],
  ): void {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      this.deletePredictionsForWalletSources(walletAddress, sources);
      for (const prediction of predictions) this.savePrediction(prediction);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  saveDecision(report: DecisionReport): void {
    this.db
      .prepare(
        `
          INSERT INTO decisions (
            id,
            generated_at,
            match_id,
            risk_mode,
            selected_home,
            selected_away,
            selected_outcome,
            utility,
            confidence,
            model_versions_json,
            source_warnings_json,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            generated_at = excluded.generated_at,
            match_id = excluded.match_id,
            risk_mode = excluded.risk_mode,
            selected_home = excluded.selected_home,
            selected_away = excluded.selected_away,
            selected_outcome = excluded.selected_outcome,
            utility = excluded.utility,
            confidence = excluded.confidence,
            model_versions_json = excluded.model_versions_json,
            source_warnings_json = excluded.source_warnings_json,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        report.id,
        report.generatedAt,
        report.matchId,
        report.riskMode,
        report.selected.score.home,
        report.selected.score.away,
        report.selected.outcome,
        report.selected.utility,
        report.selected.confidence,
        jsonStringify(report.modelVersions),
        jsonStringify(report.sourceWarnings),
        jsonStringify(report),
      );
  }

  listDecisions(): DecisionReport[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM decisions ORDER BY generated_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as DecisionReport);
  }

  getDecision(decisionId: string): DecisionReport | null {
    const row = this.db
      .prepare('SELECT payload_json FROM decisions WHERE id = ?')
      .get(decisionId) as JsonPayloadRow | undefined;
    return row ? (JSON.parse(row.payload_json) as DecisionReport) : null;
  }

  deleteDecision(decisionId: string): boolean {
    const result = this.db.prepare('DELETE FROM decisions WHERE id = ?').run(decisionId);
    return result.changes > 0;
  }

  saveTransactionPlan(plan: StoredTransactionPlan): void {
    this.db
      .prepare(
        `
          INSERT INTO transaction_plans (
            id,
            created_at,
            updated_at,
            decision_id,
            kind,
            status,
            wallet,
            program_id,
            method,
            value_planck,
            risk_mode,
            requires_approval,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            decision_id = excluded.decision_id,
            kind = excluded.kind,
            status = excluded.status,
            wallet = excluded.wallet,
            program_id = excluded.program_id,
            method = excluded.method,
            value_planck = excluded.value_planck,
            risk_mode = excluded.risk_mode,
            requires_approval = excluded.requires_approval,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        plan.id,
        plan.createdAt,
        plan.updatedAt,
        plan.decisionId,
        plan.kind,
        plan.status,
        plan.wallet,
        plan.programId,
        plan.method,
        plan.valuePlanck,
        plan.riskMode,
        plan.requiresApproval ? 1 : 0,
        jsonStringify(plan),
      );
  }

  listTransactionPlans(): StoredTransactionPlan[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM transaction_plans ORDER BY created_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredTransactionPlan);
  }

  getTransactionPlan(planId: string): StoredTransactionPlan | null {
    const row = this.db
      .prepare('SELECT payload_json FROM transaction_plans WHERE id = ?')
      .get(planId) as JsonPayloadRow | undefined;
    return row ? (JSON.parse(row.payload_json) as StoredTransactionPlan) : null;
  }

  listOpenTransactionPlansForExposure(excludePlanId: string): StoredTransactionPlan[] {
    const rows = this.db
      .prepare(
        `
          SELECT payload_json
          FROM transaction_plans
          WHERE id != ?
            AND kind IN ('PlaceBet', 'SubmitPodiumPick')
            AND status NOT IN ('blocked', 'failed', 'cancelled')
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(excludePlanId) as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredTransactionPlan);
  }

  saveTransactionResult(result: StoredTransactionResult): void {
    this.db
      .prepare(
        `
          INSERT INTO transaction_results (
            id,
            plan_id,
            created_at,
            updated_at,
            status,
            tx_hash,
            message_id,
            block_hash,
            block_number,
            error,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            plan_id = excluded.plan_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            status = excluded.status,
            tx_hash = excluded.tx_hash,
            message_id = excluded.message_id,
            block_hash = excluded.block_hash,
            block_number = excluded.block_number,
            error = excluded.error,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        result.id,
        result.planId,
        result.createdAt,
        result.updatedAt,
        result.status,
        result.txHash,
        result.messageId,
        result.blockHash,
        result.blockNumber,
        result.error,
        jsonStringify(result),
      );
  }

  listTransactionResults(): StoredTransactionResult[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM transaction_results ORDER BY created_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredTransactionResult);
  }

  saveOutcomeEvaluation(evaluation: StoredOutcomeEvaluation): void {
    this.db
      .prepare(
        `
          INSERT INTO outcome_evaluations (
            id,
            decision_id,
            match_id,
            evaluated_at,
            status,
            actual_result_status,
            awarded_weighted_points,
            payout_status,
            amount_claimable_planck,
            error_classification,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            decision_id = excluded.decision_id,
            match_id = excluded.match_id,
            evaluated_at = excluded.evaluated_at,
            status = excluded.status,
            actual_result_status = excluded.actual_result_status,
            awarded_weighted_points = excluded.awarded_weighted_points,
            payout_status = excluded.payout_status,
            amount_claimable_planck = excluded.amount_claimable_planck,
            error_classification = excluded.error_classification,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        evaluation.id,
        evaluation.decisionId,
        evaluation.matchId,
        evaluation.evaluatedAt,
        evaluation.status,
        evaluation.actual.resultStatus,
        evaluation.points.awardedWeightedPoints,
        evaluation.payout.status,
        evaluation.payout.amountClaimablePlanck,
        evaluation.errorClassification,
        jsonStringify(evaluation),
      );
  }

  listOutcomeEvaluations(): StoredOutcomeEvaluation[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM outcome_evaluations ORDER BY evaluated_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredOutcomeEvaluation);
  }

  saveParserTelemetry(entry: StoredParserTelemetry): void {
    this.db
      .prepare(
        `
          INSERT INTO parser_telemetry (
            id,
            created_at,
            transport,
            raw_text_hash,
            raw_text_length,
            chat_hash,
            user_hash,
            parsed_intent,
            parsed_permission,
            parsed_safety,
            confidence,
            action_taken,
            safety_outcome,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            transport = excluded.transport,
            raw_text_hash = excluded.raw_text_hash,
            raw_text_length = excluded.raw_text_length,
            chat_hash = excluded.chat_hash,
            user_hash = excluded.user_hash,
            parsed_intent = excluded.parsed_intent,
            parsed_permission = excluded.parsed_permission,
            parsed_safety = excluded.parsed_safety,
            confidence = excluded.confidence,
            action_taken = excluded.action_taken,
            safety_outcome = excluded.safety_outcome,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        entry.id,
        entry.createdAt,
        entry.transport,
        entry.rawTextHash,
        entry.rawTextLength,
        entry.chatHash,
        entry.userHash,
        entry.parsedIntent,
        entry.parsedPermission,
        entry.parsedSafety,
        entry.confidence,
        entry.actionTaken,
        entry.safetyOutcome,
        jsonStringify(entry),
      );
  }

  listParserTelemetry(): StoredParserTelemetry[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM parser_telemetry ORDER BY created_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredParserTelemetry);
  }

  saveTelegramPreference(preference: StoredTelegramPreference): void {
    this.db
      .prepare(
        `
          INSERT INTO telegram_preferences (
            id,
            created_at,
            updated_at,
            role,
            subject_id,
            subject_hash,
            tournament_id,
            default_risk_mode,
            simulation_objective,
            strategy_posture,
            updated_by,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            role = excluded.role,
            subject_id = excluded.subject_id,
            subject_hash = excluded.subject_hash,
            tournament_id = excluded.tournament_id,
            default_risk_mode = excluded.default_risk_mode,
            simulation_objective = excluded.simulation_objective,
            strategy_posture = excluded.strategy_posture,
            updated_by = excluded.updated_by,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        preference.id,
        preference.createdAt,
        preference.updatedAt,
        preference.role,
        preference.subjectId,
        preference.subjectHash,
        preference.tournamentId,
        preference.defaultRiskMode,
        preference.simulationObjective,
        preference.strategyPosture,
        preference.updatedBy,
        jsonStringify(preference),
      );
  }

  listTelegramPreferences(): StoredTelegramPreference[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM telegram_preferences ORDER BY updated_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredTelegramPreference);
  }

  getTelegramPreference(input: {
    subjectId: string;
    tournamentId: string;
    role: StoredTelegramPreference['role'];
  }): StoredTelegramPreference | null {
    const row = this.db
      .prepare(
        `
          SELECT payload_json FROM telegram_preferences
          WHERE subject_id = ?
            AND tournament_id = ?
            AND role = ?
          LIMIT 1
        `,
      )
      .get(input.subjectId, input.tournamentId, input.role) as JsonPayloadRow | undefined;
    return row ? (JSON.parse(row.payload_json) as StoredTelegramPreference) : null;
  }

  saveRuntimePolicy(policy: StoredRuntimePolicy): void {
    this.db
      .prepare(
        `
          INSERT INTO runtime_policies (
            id,
            created_at,
            updated_at,
            mode,
            source,
            updated_by,
            startup_env_mode,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            mode = excluded.mode,
            source = excluded.source,
            updated_by = excluded.updated_by,
            startup_env_mode = excluded.startup_env_mode,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        policy.id,
        policy.createdAt,
        policy.updatedAt,
        policy.mode,
        policy.source,
        policy.updatedBy,
        policy.startupEnvMode,
        jsonStringify(policy),
      );
  }

  listRuntimePolicies(): StoredRuntimePolicy[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM runtime_policies ORDER BY updated_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredRuntimePolicy);
  }

  getRuntimePolicy(id = 'runtime-policy:operator'): StoredRuntimePolicy | null {
    const row = this.db
      .prepare('SELECT payload_json FROM runtime_policies WHERE id = ? LIMIT 1')
      .get(id) as JsonPayloadRow | undefined;
    return row ? (JSON.parse(row.payload_json) as StoredRuntimePolicy) : null;
  }

  saveTelegramPredictionAlert(alert: StoredTelegramPredictionAlert): void {
    this.db
      .prepare(
        `
          INSERT INTO telegram_prediction_alerts (
            id,
            created_at,
            sent_at,
            chat_id,
            tournament_id,
            match_id,
            alert_lead_minutes,
            prediction_cutoff_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            sent_at = excluded.sent_at,
            chat_id = excluded.chat_id,
            tournament_id = excluded.tournament_id,
            match_id = excluded.match_id,
            alert_lead_minutes = excluded.alert_lead_minutes,
            prediction_cutoff_at = excluded.prediction_cutoff_at,
            payload_json = excluded.payload_json
        `,
      )
      .run(
        alert.id,
        alert.createdAt,
        alert.sentAt,
        alert.chatId,
        alert.tournamentId,
        alert.matchId,
        alert.alertLeadMinutes,
        alert.predictionCutoffAt,
        jsonStringify(alert),
      );
  }

  listTelegramPredictionAlerts(): StoredTelegramPredictionAlert[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM telegram_prediction_alerts ORDER BY sent_at ASC, id ASC')
      .all() as JsonPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as StoredTelegramPredictionAlert);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const migration of MIGRATIONS) {
      const row = this.db
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .get(migration.version) as { version: number } | undefined;
      if (row) continue;

      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
        this.db.exec('COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK;');
        throw error;
      }
    }
  }
}
