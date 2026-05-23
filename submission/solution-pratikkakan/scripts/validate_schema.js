#!/usr/bin/env node
/**
 * CI schema validator — runs after `npm ci`, before tests.
 * Creates a fresh in-memory SQLite database, applies the production schema,
 * then verifies all expected tables and columns exist.
 * Exits 0 on success, 1 on any missing table or column.
 */

'use strict';

const Database = require('better-sqlite3');

// ── Schema (kept in sync with src/service/db.ts) ─────────────────────────────

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

// ── Expected structure ────────────────────────────────────────────────────────

const EXPECTED = {
  wallets: ['id', 'balance', 'currency', 'created_at'],
  transfers: [
    'id',
    'source_wallet_id',
    'destination_wallet_id',
    'amount',
    'currency',
    'status',
    'reference',
    'idempotency_key',
    'created_at',
    'updated_at',
  ],
  idempotency_keys: ['key', 'transfer_id', 'request_hash', 'response_status', 'response_body', 'created_at'],
  transfer_events: ['id', 'transfer_id', 'event_type', 'payload', 'created_at'],
  outbox_events: ['id', 'transfer_id', 'event_type', 'published', 'created_at'],
};

// ── Validate ──────────────────────────────────────────────────────────────────

const db = new Database(':memory:');
db.exec(SCHEMA_SQL);

let passed = true;

for (const [table, expectedCols] of Object.entries(EXPECTED)) {
  const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();

  if (tableInfo.length === 0) {
    console.error(`[FAIL] Table missing: ${table}`);
    passed = false;
    continue;
  }

  const actualCols = new Set(tableInfo.map((row) => row.name));

  for (const col of expectedCols) {
    if (!actualCols.has(col)) {
      console.error(`[FAIL] Missing column: ${table}.${col}`);
      passed = false;
    }
  }

  if (passed) {
    console.log(`[OK]   ${table} (${expectedCols.join(', ')})`);
  }
}

db.close();

if (!passed) {
  console.error('\nSchema validation FAILED — see errors above.');
  process.exit(1);
}

console.log('\nSchema validation passed.');
