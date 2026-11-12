import Database from 'better-sqlite3';

export type Db = Database.Database;

export const SCHEMA_SQL = `
CREATE TABLE customers (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE payment_methods (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id)
);

CREATE TABLE subscriptions (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  payment_method_id  TEXT NOT NULL REFERENCES payment_methods(id),
  plan               TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at      TEXT NOT NULL,
  current_period_end TEXT,
  canceled_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK ((status = 'canceled') = (canceled_at IS NOT NULL))
);

CREATE TABLE invoices (
  id                 TEXT PRIMARY KEY,
  subscription_id    TEXT NOT NULL REFERENCES subscriptions(id),
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  idempotency_key    TEXT NOT NULL UNIQUE,
  provider_charge_id TEXT,
  failure_reason     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);

CREATE TABLE webhook_events (
  event_id        TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  invoice_id      TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('processed', 'ignored_stale', 'ignored_invalid_transition', 'ignored_unknown_reference')),
  received_at     TEXT NOT NULL
);

CREATE TABLE subscription_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  kind            TEXT NOT NULL CHECK (kind IN ('created', 'transition', 'event')),
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  trigger_name    TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('api', 'billing', 'webhook')),
  reference       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_subscription_events_subscription ON subscription_events(subscription_id);
`;

/** Opens a database (in-memory by default) and creates the schema. */
export function createDatabase(filename = ':memory:'): Db {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/** Runs `work` in one transaction: all of it is saved, or none of it is. */
export function inTransaction<T>(db: Db, work: () => T): T {
  return db.transaction(work)();
}
