/**
 * Database Connection and Initialization
 *
 * Uses better-sqlite3 for in-memory database during tests.
 * Supports schema migrations and cleanup.
 */

import Database from 'better-sqlite3';

export function createDatabase(filename: string = ':memory:'): Database.Database {
  const db = new Database(filename);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
}

export function initializeSchema(db: Database.Database): void {
  // Create subscriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro')),
      status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
      payment_method_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      trial_end_at TEXT,
      canceled_at TEXT
    )
  `);

  // Create invoices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
      attempt_count INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    )
  `);

  // Create webhook_events table (for idempotency tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      is_duplicate INTEGER DEFAULT 0,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    )
  `);

  // Create state_transitions table (audit trail)
  db.exec(`
    CREATE TABLE IF NOT EXISTS state_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_detail TEXT,
      transitioned_at TEXT NOT NULL,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    )
  `);
}

export function cleanDatabase(db: Database.Database): void {
  db.exec('DELETE FROM state_transitions');
  db.exec('DELETE FROM webhook_events');
  db.exec('DELETE FROM invoices');
  db.exec('DELETE FROM subscriptions');
}
