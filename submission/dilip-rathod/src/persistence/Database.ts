import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from 'sql.js';
import { SCHEMA_SQL, transitionSeedSql } from './schema';

export type Param = string | number | null;
export type Row = Record<string, SqlValue>;

let engine: Promise<SqlJsStatic> | undefined;

/**
 * Thin wrapper over an in-memory SQLite database (sql.js / WASM).
 * Every query is synchronous, which lets transactions be plain synchronous callbacks.
 */
export class Database {
  private transactionDepth = 0;

  private constructor(private readonly db: SqlJsDatabase) {}

  static async open(): Promise<Database> {
    engine ??= initSqlJs();
    const SQL = await engine;
    const database = new Database(new SQL.Database());
    database.db.exec('PRAGMA foreign_keys = ON;');
    database.db.exec(SCHEMA_SQL);
    database.db.exec(transitionSeedSql());
    return database;
  }

  /** Executes a statement and returns the number of rows changed. */
  run(sql: string, params: Param[] = []): number {
    this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  all<T extends object = Row>(sql: string, params: Param[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  get<T extends object = Row>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  /** Runs `work` atomically. Nested calls join the outer transaction. */
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.db.exec('BEGIN');
    this.transactionDepth++;
    try {
      const result = work();
      if (result instanceof Promise) throw new Error('Database.transaction does not support async work');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  close(): void {
    this.db.close();
  }
}
