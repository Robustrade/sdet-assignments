
import type BetterSqlite3 from 'better-sqlite3';

export function initializeSchema(
  db: BetterSqlite3.Database
): void {

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      currency TEXT NOT NULL,
      trial_days INTEGER NOT NULL CHECK(trial_days >= 0),
      charge_immediately INTEGER NOT NULL
        CHECK(charge_immediately IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      payment_method_id TEXT NOT NULL,

      status TEXT NOT NULL CHECK(
        status IN (
          'trialing',
          'active',
          'past_due',
          'canceled'
        )
      ),

      trial_ends_at TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      canceled_at TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0),
      currency TEXT NOT NULL,

      status TEXT NOT NULL CHECK(
        status IN (
          'pending',
          'succeeded',
          'failed',
          'refunded'
        )
      ),

      provider_reference TEXT,
      failure_reason TEXT,
      billing_period_start TEXT,
      billing_period_end TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      subscription_id TEXT,
      payload_json TEXT NOT NULL,

      processing_status TEXT NOT NULL CHECK(
        processing_status IN (
          'received',
          'processed',
          'ignored',
          'failed'
        )
      ),

      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,

      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT,
      source TEXT NOT NULL,
      metadata_json TEXT,

      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
      ON subscriptions(customer_id);

    CREATE INDEX IF NOT EXISTS idx_invoices_subscription
      ON invoices(subscription_id);

    CREATE INDEX IF NOT EXISTS idx_webhooks_subscription
      ON webhook_events(subscription_id);

    CREATE INDEX IF NOT EXISTS idx_audit_subscription
      ON audit_logs(subscription_id);
  `);
}
