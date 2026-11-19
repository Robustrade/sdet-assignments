import { Db } from '../db/database';
import { Plan } from '../domain/types';

const COLUMNS =
  'id, price_minor AS priceMinor, currency, trial_days AS trialDays, billing_interval_days AS billingIntervalDays';

export class PlanRepository {
  constructor(private readonly db: Db) {}

  insert(plan: Plan): void {
    this.db
      .prepare(
        `INSERT INTO plans (id, price_minor, currency, trial_days, billing_interval_days)
         VALUES (@id, @priceMinor, @currency, @trialDays, @billingIntervalDays)`,
      )
      .run(plan);
  }

  findById(id: string): Plan | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM plans WHERE id = ?`).get(id) as Plan | undefined;
  }
}
