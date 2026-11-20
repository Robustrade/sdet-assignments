import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE customers (id TEXT PRIMARY KEY);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  payment_method_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  trial_ends_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','failed','refunded')),
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','ignored','duplicate')),
  received_at TEXT NOT NULL
);

CREATE TABLE subscription_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  source TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

/** Fresh in-memory database per call => every test gets isolated, empty state. */
export function createDatabase(customerIds: string[] = []): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO customers (id) VALUES (?)');
  customerIds.forEach((id) => insert.run(id));
  return db;
}
