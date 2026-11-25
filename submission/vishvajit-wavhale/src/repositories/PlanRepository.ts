
import type BetterSqlite3 from 'better-sqlite3';

export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  trial_days: number;
  charge_immediately: number;
}

export class PlanRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  findById(id: string): Plan | null {
    const statement = this.db.prepare(`
      SELECT id, name, price_cents, currency,
             trial_days, charge_immediately
      FROM plans
      WHERE id = ?
    `);

    const plan = statement.get(id) as Plan | undefined;

    return plan ?? null;
  }

  findByName(name: string): Plan | null {
    const statement = this.db.prepare(`
      SELECT id, name, price_cents, currency,
             trial_days, charge_immediately
      FROM plans
      WHERE name = ?
    `);

    const plan = statement.get(name) as Plan | undefined;

    return plan ?? null;
  }

  findAll(): Plan[] {
    const statement = this.db.prepare(`
      SELECT id, name, price_cents, currency,
             trial_days, charge_immediately
      FROM plans
      ORDER BY price_cents ASC
    `);

    return statement.all() as Plan[];
  }
}
