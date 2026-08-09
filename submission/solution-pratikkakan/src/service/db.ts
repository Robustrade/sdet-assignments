import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

// ── Domain types ──────────────────────────────────────────────────────────────

export type Wallet = {
  id: string;
  balance: number;
  currency: string;
  created_at: string;
};

export type TransferStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export type Transfer = {
  id: string;
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  reference: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type IdempotencyKey = {
  key: string;
  transfer_id: string;
  request_hash: string;
  response_status: number;
  response_body: string;
  created_at: string;
};

export type TransferEventType = 'TRANSFER_INITIATED' | 'TRANSFER_COMPLETED' | 'TRANSFER_FAILED';

export type TransferEvent = {
  id: string;
  transfer_id: string;
  event_type: TransferEventType;
  payload: string;
  created_at: string;
};

export type OutboxEvent = {
  id: string;
  transfer_id: string;
  event_type: string;
  published: number;
  created_at: string;
};

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS wallets (
    id          TEXT PRIMARY KEY,
    balance     INTEGER NOT NULL,
    currency    TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id                    TEXT PRIMARY KEY,
    source_wallet_id      TEXT NOT NULL,
    destination_wallet_id TEXT NOT NULL,
    amount                INTEGER NOT NULL,
    currency              TEXT NOT NULL,
    status                TEXT NOT NULL,
    reference             TEXT,
    idempotency_key       TEXT UNIQUE,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT PRIMARY KEY,
    transfer_id     TEXT NOT NULL,
    request_hash    TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body   TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transfer_events (
    id          TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outbox_events (
    id          TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    published   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
`;

export function createDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  // WAL mode: concurrent readers don't block writers and vice-versa
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
