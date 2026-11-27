import fs from 'fs';
import path from 'path';
import initSqlJs, { Database, SqlJsStatic, SqlValue } from 'sql.js';

export type Params = Record<string, SqlValue> | SqlValue[];
export type Row = Record<string, SqlValue>;

let sqlModule: Promise<SqlJsStatic> | undefined;

function loadSqlJs(): Promise<SqlJsStatic> {
  sqlModule ??= initSqlJs();
  return sqlModule;
}

export const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** SQLite error raised when a UNIQUE / PRIMARY KEY constraint rejects a write. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(error.message);
}

/**
 * Thin wrapper over an in-memory SQLite database (sql.js, WebAssembly; no native build).
 * Every call is synchronous, which means a transaction can't be interleaved with another
 * request unless the caller awaits inside it - and the services never do.
 */
export class SqlDatabase {
  private depth = 0;

  private constructor(private readonly db: Database) {}

  static async open(schemaSql: string = fs.readFileSync(SCHEMA_PATH, 'utf8')): Promise<SqlDatabase> {
    const SQL = await loadSqlJs();
    const db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON;');
    db.exec(schemaSql);
    return new SqlDatabase(db);
  }

  run(sql: string, params: Params = []): number {
    this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  all<T extends Row = Row>(sql: string, params: Params = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  get<T extends Row = Row>(sql: string, params: Params = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /**
   * Run `work` atomically. Nested calls join the outer transaction.
   * `work` must be synchronous - a Promise here would silently escape the transaction.
   */
  transaction<T>(work: () => T): T {
    if (this.depth > 0) return this.nested(work);
    this.db.run('BEGIN');
    this.depth++;
    try {
      const result = work();
      if (result instanceof Promise) throw new Error('transaction() work must be synchronous');
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  private nested<T>(work: () => T): T {
    this.depth++;
    try {
      return work();
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.db.close();
  }
}
