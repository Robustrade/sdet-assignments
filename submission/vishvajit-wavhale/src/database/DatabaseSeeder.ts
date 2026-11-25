
import type BetterSqlite3 from 'better-sqlite3';

export class DatabaseSeeder {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  seed(): void {
    const seedData = this.db.transaction(() => {

      const insertCustomer = this.db.prepare(`
        INSERT OR IGNORE INTO customers
          (id, name, email)
        VALUES (?, ?, ?)
      `);

      insertCustomer.run(
        'cust_001',
        'Test Customer One',
        'customer1@example.com'
      );

      insertCustomer.run(
        'cust_002',
        'Test Customer Two',
        'customer2@example.com'
      );

      const insertPlan = this.db.prepare(`
        INSERT OR IGNORE INTO plans
          (id, name, price_cents, currency,
           trial_days, charge_immediately)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      insertPlan.run(
        'plan_basic',
        'basic',
        1900,
        'USD',
        7,
        0
      );

      insertPlan.run(
        'plan_pro',
        'pro',
        4900,
        'USD',
        14,
        0
      );
    });

    seedData();
  }
}
