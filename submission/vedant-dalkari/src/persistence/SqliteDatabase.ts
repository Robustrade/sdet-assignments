/**
 * SQLite (sql.js) persistence wrapper providing schema initialization,
 * prepared query helpers, and atomic transaction execution.
 * Author: Vedant Dalkari
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BindParams, Database, SqlValue } from 'sql.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.join(THIS_DIR, 'schema.sql');

export class SqliteDatabase {
  public readonly raw: Database;
  private transactionDepth = 0;

  public constructor(raw: Database) {
    this.raw = raw;
  }

  public initializeSchema(schemaSql?: string): void {
    const ddl = schemaSql ?? fs.readFileSync(DEFAULT_SCHEMA_PATH, 'utf8');
    this.raw.run('PRAGMA foreign_keys = ON;');
    this.raw.run(ddl);
  }

  public run(sql: string, params?: BindParams): void {
    if (params !== undefined) {
      this.raw.run(sql, params);
      return;
    }
    this.raw.run(sql);
  }

  public queryAll<T extends Record<string, SqlValue>>(sql: string, params?: BindParams): T[] {
    const stmt = this.raw.prepare(sql);
    const rows: T[] = [];
    try {
      if (params !== undefined) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  public queryOne<T extends Record<string, SqlValue>>(sql: string, params?: BindParams): T | null {
    const rows = this.queryAll<T>(sql, params);
    return rows[0] ?? null;
  }

  public inTransaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      return work();
    }
    this.raw.run('BEGIN IMMEDIATE;');
    this.transactionDepth += 1;
    try {
      const result = work();
      this.raw.run('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.raw.run('ROLLBACK;');
      } catch {
        // Ignore if SQLite already implicitly rolled back the transaction.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  public close(): void {
    this.raw.close();
  }
}
