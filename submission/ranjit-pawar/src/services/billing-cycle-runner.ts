import type { Clock } from '../domain/clock';
import type { Repositories } from '../persistence/repositories';
import type { BillingEngine, ChargeAttemptOutcome } from './billing-engine';

export interface CycleReport {
  ran_at: string;
  attempts: Array<{ subscription_id: string } & ChargeAttemptOutcome>;
}

/**
 * Stands in for the scheduled billing job: charges trials that ended, periods
 * that rolled over, and retries that came due. Driving it explicitly (rather
 * than on a timer) is what lets tests own the passage of time.
 */
export class BillingCycleRunner {
  constructor(
    private readonly repos: Repositories,
    private readonly engine: BillingEngine,
    private readonly clock: Clock
  ) {}

  async run(): Promise<CycleReport> {
    const now = this.clock.now();
    const due = this.repos.subscriptions.findDueForBilling(now);
    const attempts: CycleReport['attempts'] = [];
    for (const sub of due) {
      const outcome = await this.engine.attemptCharge(sub.id, 'billing_runner');
      attempts.push({ subscription_id: sub.id, ...outcome });
    }
    return { ran_at: now.toISOString(), attempts };
  }
}
