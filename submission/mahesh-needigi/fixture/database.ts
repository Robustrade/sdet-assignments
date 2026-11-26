import Database from 'better-sqlite3';

export class BillingDatabase {
  readonly db: Database.Database;

  //when new BillingDatabase is created, by default ":memory:" creates new table in RAM by alling initSchema()
  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  //creating 4 tables
  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        payment_method_id TEXT NOT NULL,
        status TEXT NOT NULL,
        trial_days INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        subscription_id TEXT,
        type TEXT,
        processing_result TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        trigger TEXT NOT NULL
      );
    `);
  }

  //cleaning the data between each test
  reset(): void {
    this.db.exec(`
      DELETE FROM audit_history;
      DELETE FROM webhook_events;
      DELETE FROM invoices;
      DELETE FROM subscriptions;
    `);
  }
}