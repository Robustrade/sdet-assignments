import Database from 'better-sqlite3';

export function createDatabase(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      state TEXT NOT NULL,
      payment_method_id TEXT NOT NULL,
      trial_ends_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      provider_reference TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE webhook_events (
      event_id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      processed INTEGER NOT NULL,
      delivery_count INTEGER NOT NULL DEFAULT 1,
      last_received_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}
