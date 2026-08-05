import Database from 'better-sqlite3';

export function createDatabase(path: string = ':memory:'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id       TEXT    PRIMARY KEY,
      balance  INTEGER NOT NULL CHECK(balance >= 0),
      currency TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id                    TEXT    PRIMARY KEY,
      source_wallet_id      TEXT    NOT NULL,
      destination_wallet_id TEXT    NOT NULL,
      amount                INTEGER NOT NULL,
      currency              TEXT    NOT NULL,
      reference             TEXT,
      status                TEXT    NOT NULL,
      idempotency_key       TEXT    UNIQUE,
      payload_hash          TEXT,
      created_at            TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id          TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox_events (
      id          TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL
    );
  `);
}

export function seedWallets(db: Database.Database, wallets: Array<{ id: string; balance: number; currency: string }>): void {
  const insert = db.prepare('INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)');
  const insertMany = db.transaction((items: typeof wallets) => {
    for (const w of items) {
      insert.run(w.id, w.balance, w.currency);
    }
  });
  insertMany(wallets);
}
