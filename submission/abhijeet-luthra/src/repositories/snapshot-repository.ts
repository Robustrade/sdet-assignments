import { Db } from '../db/database';
import { TABLE_NAMES } from '../db/schema';

export type DatabaseSnapshot = Record<(typeof TABLE_NAMES)[number], unknown[]>;

/**
 * Full copy of every table, used by tests to prove "this request changed nothing"
 * (rejected webhooks, invalid requests, rolled-back transactions).
 */
export class SnapshotRepository {
  constructor(private readonly db: Db) {}

  snapshot(): DatabaseSnapshot {
    const result = {} as DatabaseSnapshot;
    for (const table of TABLE_NAMES) {
      result[table] = this.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    }
    return result;
  }
}
