import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export type Db = Database.Database;

/**
 * Opens a database (in-memory by default, so every test gets a fresh, isolated
 * one), turns on foreign-key enforcement and applies the schema.
 */
export function createDatabase(filename = ':memory:'): Db {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Runs `work` inside one SQLite transaction: everything commits together, or a
 * thrown error rolls everything back. better-sqlite3 transactions are
 * synchronous, so a transaction physically cannot span an `await` on the
 * external payment provider - the consistency boundary is enforced by the API.
 */
export type TransactionRunner = <T>(work: () => T) => T;

export function transactionRunner(db: Db): TransactionRunner {
  return <T>(work: () => T): T => db.transaction(work)();
}
