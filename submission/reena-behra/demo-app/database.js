// The demo app's database: one SQLite file, five simple tables.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DB_FILE = fileURLToPath(new URL('./demo.db', import.meta.url));

export function createFreshDatabase() {
  // Start every run with an empty database so old data can't affect results.
  for (const file of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    if (existsSync(file)) rmSync(file);
  }

  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE customers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      card       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE subscriptions (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL REFERENCES customers(id),
      plan            TEXT NOT NULL,
      status          TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    -- one row per payment attempt
    CREATE TABLE payments (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
      amount          INTEGER NOT NULL,
      status          TEXT NOT NULL,   -- pending | success | failed
      attempt_no      INTEGER NOT NULL,
      created_at      TEXT NOT NULL
    );

    -- every webhook event we received, so a repeated event_id is processed only once
    CREATE TABLE webhook_events (
      event_id        TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      subscription_id TEXT,
      result          TEXT NOT NULL,   -- processed | ignored
      reason          TEXT,
      received_count  INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL
    );

    -- audit trail of every status change
    CREATE TABLE status_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
      from_status     TEXT,
      to_status       TEXT NOT NULL,
      reason          TEXT NOT NULL,
      created_at      TEXT NOT NULL
    );
  `);
  return db;
}

// Runs several writes as one unit: either all of them are saved, or none.
export function runInTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
