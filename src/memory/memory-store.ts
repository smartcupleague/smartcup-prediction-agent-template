import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SqliteMemoryStore } from './sqlite-store.js';
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

type MemorySnapshot = {
  predictions: StoredPrediction[];
  reports: DecisionReport[];
  transactionPlans: StoredTransactionPlan[];
  transactionResults: StoredTransactionResult[];
  outcomeEvaluations: StoredOutcomeEvaluation[];
  parserTelemetry: StoredParserTelemetry[];
  telegramPreferences: StoredTelegramPreference[];
  runtimePolicies: StoredRuntimePolicy[];
  telegramPredictionAlerts: StoredTelegramPredictionAlert[];
};

export type MemoryStorageInfo = {
  jsonPath: string;
  sqlitePath: string;
  configuredSqlitePath: string | null;
  runningOnRender: boolean;
  likelyEphemeralOnRender: boolean;
};

const DEFAULT_MEMORY_PATH = 'data/smartcup-agent.memory.json';

function emptySnapshot(): MemorySnapshot {
  return {
    predictions: [],
    reports: [],
    transactionPlans: [],
    transactionResults: [],
    outcomeEvaluations: [],
    parserTelemetry: [],
    telegramPreferences: [],
    runtimePolicies: [],
    telegramPredictionAlerts: [],
  };
}

function readSnapshot(path: string): MemorySnapshot {
  if (!existsSync(path)) return emptySnapshot();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<MemorySnapshot>;
  return {
    predictions: Array.isArray(raw.predictions) ? raw.predictions : [],
    reports: Array.isArray(raw.reports) ? raw.reports : [],
    transactionPlans: Array.isArray(raw.transactionPlans) ? raw.transactionPlans : [],
    transactionResults: Array.isArray(raw.transactionResults) ? raw.transactionResults : [],
    outcomeEvaluations: Array.isArray(raw.outcomeEvaluations) ? raw.outcomeEvaluations : [],
    parserTelemetry: Array.isArray(raw.parserTelemetry) ? raw.parserTelemetry : [],
    telegramPreferences: Array.isArray(raw.telegramPreferences) ? raw.telegramPreferences : [],
    runtimePolicies: Array.isArray(raw.runtimePolicies) ? raw.runtimePolicies : [],
    telegramPredictionAlerts: Array.isArray(raw.telegramPredictionAlerts) ? raw.telegramPredictionAlerts : [],
  };
}

export class MemoryStore {
  private readonly path: string;
  private readonly sqlite: SqliteMemoryStore;
  private snapshot: MemorySnapshot;

  constructor(path = DEFAULT_MEMORY_PATH, sqlitePath = process.env.SMARTPREDICTOR_SQLITE_PATH) {
    this.path = resolve(path);
    this.snapshot = readSnapshot(this.path);
    this.sqlite = new SqliteMemoryStore(sqlitePath);
    this.sqlite.importSnapshot(this.snapshot);
    this.snapshot = {
      predictions: this.sqlite.listPredictions(),
      reports: this.sqlite.listDecisions(),
      transactionPlans: this.sqlite.listTransactionPlans(),
      transactionResults: this.sqlite.listTransactionResults(),
      outcomeEvaluations: this.sqlite.listOutcomeEvaluations(),
      parserTelemetry: this.sqlite.listParserTelemetry(),
      telegramPreferences: this.sqlite.listTelegramPreferences(),
      runtimePolicies: this.sqlite.listRuntimePolicies(),
      telegramPredictionAlerts: this.sqlite.listTelegramPredictionAlerts(),
    };
  }

  saveDecision(report: DecisionReport): void {
    this.snapshot.reports = [...this.snapshot.reports.filter((entry) => entry.id !== report.id), report];
    this.sqlite.saveDecision(report);
    this.flush();
  }

  listDecisions(): DecisionReport[] {
    return this.sqlite.listDecisions();
  }

  deleteDecision(decisionId: string): boolean {
    this.snapshot.reports = this.snapshot.reports.filter((entry) => entry.id !== decisionId);
    const deleted = this.sqlite.deleteDecision(decisionId);
    this.flush();
    return deleted;
  }

  storageInfo(): MemoryStorageInfo {
    const configuredSqlitePath = process.env.SMARTPREDICTOR_SQLITE_PATH?.trim() || null;
    const runningOnRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_SERVICE_NAME);
    const sqlitePath = this.sqlite.getPath();
    return {
      jsonPath: this.path,
      sqlitePath,
      configuredSqlitePath,
      runningOnRender,
      likelyEphemeralOnRender:
        runningOnRender && (!configuredSqlitePath || !sqlitePath.startsWith('/var/data/')),
    };
  }

  savePrediction(prediction: StoredPrediction): void {
    this.snapshot.predictions = [
      ...this.snapshot.predictions.filter((entry) => entry.id !== prediction.id),
      prediction,
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.savePrediction(prediction);
    this.flush();
  }

  savePredictions(predictions: StoredPrediction[]): void {
    for (const prediction of predictions) {
      this.snapshot.predictions = this.snapshot.predictions.filter((entry) => entry.id !== prediction.id);
      this.snapshot.predictions.push(prediction);
    }
    this.snapshot.predictions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.savePredictions(predictions);
    this.flush();
  }

  replacePredictionsForWalletSources(
    walletAddress: StoredPrediction['walletAddress'],
    sources: StoredPrediction['source'][],
    predictions: StoredPrediction[],
  ): void {
    this.snapshot.predictions = this.snapshot.predictions.filter(
      (entry) => !(entry.walletAddress === walletAddress && sources.includes(entry.source)),
    );
    this.snapshot.predictions.push(...predictions);
    this.snapshot.predictions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.replacePredictionsForWalletSources(walletAddress, sources, predictions);
    this.flush();
  }

  listPredictions(): StoredPrediction[] {
    return this.sqlite.listPredictions();
  }

  listPredictionsBySource(source: StoredPrediction['source']): StoredPrediction[] {
    return this.listPredictions().filter((prediction) => prediction.source === source);
  }

  saveTransactionPlan(plan: StoredTransactionPlan): void {
    this.snapshot.transactionPlans = [
      ...this.snapshot.transactionPlans.filter((entry) => entry.id !== plan.id),
      plan,
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.saveTransactionPlan(plan);
    this.flush();
  }

  listTransactionPlans(): StoredTransactionPlan[] {
    return this.sqlite.listTransactionPlans();
  }

  saveTransactionResult(result: StoredTransactionResult): void {
    this.snapshot.transactionResults = [
      ...this.snapshot.transactionResults.filter((entry) => entry.id !== result.id),
      result,
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.saveTransactionResult(result);
    this.flush();
  }

  listTransactionResults(): StoredTransactionResult[] {
    return this.sqlite.listTransactionResults();
  }

  saveOutcomeEvaluation(evaluation: StoredOutcomeEvaluation): void {
    this.snapshot.outcomeEvaluations = [
      ...this.snapshot.outcomeEvaluations.filter((entry) => entry.id !== evaluation.id),
      evaluation,
    ].sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt));
    this.sqlite.saveOutcomeEvaluation(evaluation);
    this.flush();
  }

  listOutcomeEvaluations(): StoredOutcomeEvaluation[] {
    return this.sqlite.listOutcomeEvaluations();
  }

  saveParserTelemetry(entry: StoredParserTelemetry): void {
    this.snapshot.parserTelemetry = [
      ...this.snapshot.parserTelemetry.filter((stored) => stored.id !== entry.id),
      entry,
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.sqlite.saveParserTelemetry(entry);
    this.flush();
  }

  listParserTelemetry(): StoredParserTelemetry[] {
    return this.sqlite.listParserTelemetry();
  }

  saveTelegramPreference(preference: StoredTelegramPreference): void {
    this.snapshot.telegramPreferences = [
      ...this.snapshot.telegramPreferences.filter((entry) => entry.id !== preference.id),
      preference,
    ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    this.sqlite.saveTelegramPreference(preference);
    this.flush();
  }

  listTelegramPreferences(): StoredTelegramPreference[] {
    return this.sqlite.listTelegramPreferences();
  }

  getTelegramPreference(input: {
    subjectId: string;
    tournamentId: string;
    role: StoredTelegramPreference['role'];
  }): StoredTelegramPreference | null {
    return this.sqlite.getTelegramPreference(input);
  }

  saveRuntimePolicy(policy: StoredRuntimePolicy): void {
    this.snapshot.runtimePolicies = [
      ...this.snapshot.runtimePolicies.filter((entry) => entry.id !== policy.id),
      policy,
    ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    this.sqlite.saveRuntimePolicy(policy);
    this.flush();
  }

  listRuntimePolicies(): StoredRuntimePolicy[] {
    return this.sqlite.listRuntimePolicies();
  }

  getRuntimePolicy(id = 'runtime-policy:operator'): StoredRuntimePolicy | null {
    return this.sqlite.getRuntimePolicy(id);
  }

  saveTelegramPredictionAlert(alert: StoredTelegramPredictionAlert): void {
    this.snapshot.telegramPredictionAlerts = [
      ...this.snapshot.telegramPredictionAlerts.filter((entry) => entry.id !== alert.id),
      alert,
    ].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    this.sqlite.saveTelegramPredictionAlert(alert);
    this.flush();
  }

  listTelegramPredictionAlerts(): StoredTelegramPredictionAlert[] {
    return this.sqlite.listTelegramPredictionAlerts();
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, `${jsonStringify(this.snapshot, 2)}\n`);
    renameSync(`${this.path}.tmp`, this.path);
  }
}
