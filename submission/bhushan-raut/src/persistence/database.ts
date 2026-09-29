import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema';

export type Db = DatabaseSync;

export function openDatabase(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const depth = new WeakMap<Db, number>();

/**
 * Runs fn atomically. Nested calls join the outer transaction. fn must be synchronous:
 * a transaction must never stay open across an await (e.g. a provider call).
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  const current = depth.get(db) ?? 0;
  if (current > 0) {
    depth.set(db, current + 1);
    try {
      return fn();
    } finally {
      depth.set(db, current);
    }
  }

  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('inTransaction: fn must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    depth.set(db, 0);
  }
}

/** node:sqlite returns null-prototype objects; callers get plain, typed rows. */
export function one<T>(db: Db, sql: string, ...params: (string | number | null)[]): T | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}
