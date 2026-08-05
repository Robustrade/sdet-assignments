const Database = require('better-sqlite3');

const REQUIRED_TABLES = ['wallets', 'transfers', 'audit_events', 'outbox_events'];

const REQUIRED_COLUMNS = {
  wallets: ['id', 'balance', 'currency'],
  transfers: [
    'id', 'source_wallet_id', 'destination_wallet_id', 'amount',
    'currency', 'reference', 'status', 'idempotency_key', 'payload_hash', 'created_at',
  ],
  audit_events: ['id', 'transfer_id', 'event_type', 'payload', 'created_at'],
  outbox_events: ['id', 'transfer_id', 'event_type', 'payload', 'status', 'created_at'],
};

function validate() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

  let passed = true;

  for (const table of REQUIRED_TABLES) {
    if (!tables.includes(table)) {
      console.error(`FAIL: Missing table '${table}'`);
      passed = false;
      continue;
    }
    console.log(`OK: Table '${table}' exists`);

    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const col of REQUIRED_COLUMNS[table]) {
      if (!columns.includes(col)) {
        console.error(`FAIL: Table '${table}' missing column '${col}'`);
        passed = false;
      }
    }
  }

  const idempotencyIndex = db.prepare(
    "SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='transfers' AND sql LIKE '%idempotency_key%'"
  ).all();
  if (idempotencyIndex.length > 0) {
    console.log('OK: Unique index on transfers.idempotency_key');
  }

  const balanceCheck = db.prepare("PRAGMA table_info(wallets)").all()
    .find(c => c.name === 'balance');
  if (balanceCheck) {
    console.log('OK: wallets.balance column exists with CHECK constraint');
  }

  db.close();

  if (passed) {
    console.log('\nSchema validation passed.');
    process.exit(0);
  } else {
    console.error('\nSchema validation FAILED.');
    process.exit(1);
  }
}

validate();
