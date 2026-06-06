import type { AgentConfig, DecisionReport } from '../types/index.js';
import { ConfirmationReadbackAdvisor } from './confirmation-readback.js';
import { TransportRecoveryAdvisor } from './transport-recovery.js';

export class VaraExecutor {
  readonly confirmationReadback: ConfirmationReadbackAdvisor;
  readonly transportRecovery: TransportRecoveryAdvisor;

  constructor(private readonly config: AgentConfig) {
    this.confirmationReadback = new ConfirmationReadbackAdvisor(config);
    this.transportRecovery = new TransportRecoveryAdvisor(config);
  }

  async submitPrediction(report: DecisionReport): Promise<never> {
    void report;
    throw new Error(`Execution disabled in scaffold. Current mode: ${this.config.policy.mode}`);
  }
}
