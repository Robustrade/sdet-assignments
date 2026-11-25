
import BetterSqlite3 from 'better-sqlite3';

export class SqliteDatabase {
  private readonly db: BetterSqlite3.Database;

  constructor(filename: string = ':memory:') {
    this.db = new BetterSqlite3(filename);

    // Enforce foreign key relationships
    this.db.pragma('foreign_keys = ON');

    // Enable WAL for file-backed databases
    if (filename !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
  }

  get connection(): BetterSqlite3.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
