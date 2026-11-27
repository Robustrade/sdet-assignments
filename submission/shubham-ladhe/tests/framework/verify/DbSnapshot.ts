import { SqlDatabase } from '../../../src/persistence/SqlDatabase';

const TABLES = [
  'subscriptions',
  'invoices',
  'charge_attempts',
  'webhook_events',
  'audit_log',
  'notifications',
  'idempotency_keys',
] as const;
export type TableName = (typeof TABLES)[number];

/**
 * Row counts plus a content fingerprint per table. Used for "nothing changed" assertions:
 * take one before the action, one after, and compare. Catches updates, not only inserts.
 */
export class DbSnapshot {
  private constructor(readonly tables: Record<TableName, { rows: number; fingerprint: string }>) {}

  static take(db: SqlDatabase): DbSnapshot {
    const tables = {} as Record<TableName, { rows: number; fingerprint: string }>;
    for (const table of TABLES) {
      const rows = db.all(`SELECT * FROM ${table} ORDER BY rowid`);
      tables[table] = { rows: rows.length, fingerprint: JSON.stringify(rows) };
    }
    return new DbSnapshot(tables);
  }

  /** Tables whose contents differ from `other`. */
  changedSince(other: DbSnapshot): TableName[] {
    return TABLES.filter((table) => this.tables[table].fingerprint !== other.tables[table].fingerprint);
  }

  rowDelta(other: DbSnapshot): Partial<Record<TableName, number>> {
    const delta: Partial<Record<TableName, number>> = {};
    for (const table of TABLES) {
      const rowsAdded = this.tables[table].rows - other.tables[table].rows;
      if (rowsAdded !== 0) delta[table] = rowsAdded;
    }
    return delta;
  }
}
