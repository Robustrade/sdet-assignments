import Database from 'better-sqlite3';

export type Db = Database.Database;

export function createDb(dbPath: string = ':memory:'): Db {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                TEXT PRIMARY KEY,
      customer_id       TEXT NOT NULL,
      plan              TEXT NOT NULL,
      state             TEXT NOT NULL,
      payment_method_id TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      invoice_id      TEXT NOT NULL,
      status          TEXT NOT NULL,
      amount          INTEGER NOT NULL,
      currency        TEXT NOT NULL,
      provider_ref    TEXT NOT NULL,
      event_id        TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      UNIQUE (subscription_id, invoice_id, event_id),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id        TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      type            TEXT NOT NULL,
      outcome         TEXT NOT NULL,
      processed_at    TEXT NOT NULL
    );
  `);
}