#!/usr/bin/env node
/**
 * Schema validation: loads src/persistence/schema.sql into a fresh SQLite database and checks
 * that the tables, columns, keys, constraints and indexes the tests rely on are really there,
 * then proves the critical constraints fire. Exits non-zero with a list of problems otherwise.
 *
 *   node scripts/validate_schema.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = path.join(__dirname, '..', 'src', 'persistence', 'schema.sql');

const EXPECTED_COLUMNS = {
  customers: ['id', 'email', 'created_at'],
  payment_methods: ['id', 'customer_id', 'brand', 'last4', 'status'],
  subscriptions: [
    'id', 'customer_id', 'plan', 'status', 'payment_method_id', 'price_cents', 'currency', 'trial_ends_at',
    'current_period_start', 'current_period_end', 'canceled_at', 'cancel_reason', 'version', 'created_at', 'updated_at',
  ],
  invoices: [
    'id', 'subscription_id', 'amount_cents', 'currency', 'status', 'period_start', 'period_end', 'failed_attempts',
    'next_retry_at', 'paid_at', 'created_at', 'updated_at',
  ],
  charge_attempts: [
    'id', 'invoice_id', 'attempt_no', 'idempotency_key', 'amount_cents', 'status', 'provider_charge_id',
    'failure_reason', 'created_at', 'settled_at',
  ],
  webhook_events: ['event_id', 'type', 'subscription_id', 'invoice_id', 'payload', 'outcome', 'reason', 'received_at'],
  audit_log: ['id', 'subscription_id', 'seq', 'action', 'from_status', 'to_status', 'source', 'reference', 'at', 'prev_hash', 'hash'],
  notifications: ['id', 'subscription_id', 'kind', 'reference', 'created_at'],
  idempotency_keys: ['key', 'request_hash', 'response_status', 'response_body', 'created_at'],
};

/** Unique keys that idempotency and duplicate-protection depend on. */
const EXPECTED_UNIQUE = [
  ['webhook_events', ['event_id']],
  ['charge_attempts', ['idempotency_key']],
  ['charge_attempts', ['invoice_id', 'attempt_no']],
  ['charge_attempts', ['provider_charge_id']],
  ['invoices', ['subscription_id', 'period_start']],
  ['audit_log', ['subscription_id', 'seq']],
  ['notifications', ['kind', 'reference']],
  ['idempotency_keys', ['key']],
];

const EXPECTED_FOREIGN_KEYS = [
  ['payment_methods', 'customer_id', 'customers'],
  ['subscriptions', 'customer_id', 'customers'],
  ['subscriptions', 'payment_method_id', 'payment_methods'],
  ['invoices', 'subscription_id', 'subscriptions'],
  ['charge_attempts', 'invoice_id', 'invoices'],
  ['audit_log', 'subscription_id', 'subscriptions'],
];

const EXPECTED_INDEXES = [
  'idx_subscriptions_status',
  'idx_invoices_subscription',
  'idx_attempts_invoice',
  'idx_webhook_events_subscription',
  'idx_audit_subscription',
];

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function uniqueKeys(db, table) {
  const keys = [];
  for (const col of rows(db, `PRAGMA table_info(${table})`)) {
    if (col.pk === 1) keys.push([col.name]);
  }
  for (const idx of rows(db, `PRAGMA index_list(${table})`)) {
    if (idx.unique !== 1) continue;
    keys.push(rows(db, `PRAGMA index_info(${idx.name})`).map((c) => c.name));
  }
  return keys.map((k) => k.join(','));
}

/** Run a statement that MUST be rejected; returns an error string if it wasn't. */
function mustFail(db, label, sql, pattern) {
  try {
    db.run('SAVEPOINT probe');
    db.run(sql);
    return `constraint not enforced: ${label}`;
  } catch (e) {
    return pattern.test(e.message) ? null : `${label}: unexpected error ${e.message}`;
  } finally {
    db.run('ROLLBACK TO probe');
    db.run('RELEASE probe');
  }
}

async function main() {
  const problems = [];
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');

  try {
    db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  } catch (e) {
    console.error(`schema.sql does not load: ${e.message}`);
    process.exit(1);
  }

  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = rows(db, `PRAGMA table_info(${table})`).map((c) => c.name);
    if (actual.length === 0) {
      problems.push(`missing table ${table}`);
      continue;
    }
    for (const c of cols) if (!actual.includes(c)) problems.push(`missing column ${table}.${c}`);
  }

  for (const [table, cols] of EXPECTED_UNIQUE) {
    if (!uniqueKeys(db, table).includes(cols.join(','))) problems.push(`missing UNIQUE(${cols.join(', ')}) on ${table}`);
  }

  for (const [table, from, to] of EXPECTED_FOREIGN_KEYS) {
    const fks = rows(db, `PRAGMA foreign_key_list(${table})`);
    if (!fks.some((fk) => fk.from === from && fk.table === to)) problems.push(`missing FOREIGN KEY ${table}.${from} -> ${to}`);
  }

  const indexes = rows(db, "SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name);
  for (const idx of EXPECTED_INDEXES) if (!indexes.includes(idx)) problems.push(`missing index ${idx}`);

  // Behavioural probes: the CHECK and UNIQUE constraints must actually reject bad rows.
  db.run("INSERT INTO customers VALUES ('c1', 'c1@example.test', '2026-01-01T00:00:00.000Z')");
  db.run("INSERT INTO payment_methods VALUES ('pm1', 'c1', 'visa', '4242', 'active')");
  db.run(`INSERT INTO subscriptions (id, customer_id, plan, status, payment_method_id, price_cents, currency, trial_ends_at,
            current_period_start, current_period_end, created_at, updated_at)
          VALUES ('s1', 'c1', 'basic', 'trialing', 'pm1', 1900, 'USD', '2026-01-15T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
  db.run(`INSERT INTO webhook_events VALUES ('evt_1', 'payment.succeeded', 's1', 'i1', '{}', 'processed', NULL, '2026-01-01T00:00:00.000Z')`);

  const probes = [
    ['unknown subscription status', "UPDATE subscriptions SET status = 'paused'", /CHECK/],
    ['canceled without canceled_at', "UPDATE subscriptions SET status = 'canceled'", /CHECK/],
    ['unknown plan', "UPDATE subscriptions SET plan = 'gold'", /CHECK/],
    ['zero price', 'UPDATE subscriptions SET price_cents = 0', /CHECK/],
    ['duplicate webhook event_id',
      "INSERT INTO webhook_events VALUES ('evt_1', 'payment.failed', 's1', 'i1', '{}', 'processed', NULL, '2026-01-02T00:00:00.000Z')", /UNIQUE|PRIMARY/],
    ['ignored webhook without reason', "UPDATE webhook_events SET outcome = 'ignored'", /CHECK/],
    ['subscription for missing customer', "UPDATE subscriptions SET customer_id = 'nobody'", /FOREIGN KEY/],
  ];
  for (const [label, sql, pattern] of probes) {
    const problem = mustFail(db, label, sql, pattern);
    if (problem) problems.push(problem);
  }

  db.close();

  if (problems.length > 0) {
    console.error(`Schema validation FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const tables = Object.keys(EXPECTED_COLUMNS).length;
  console.log(
    `Schema OK: ${tables} tables, ${EXPECTED_UNIQUE.length} unique keys, ${EXPECTED_FOREIGN_KEYS.length} foreign keys, ` +
      `${EXPECTED_INDEXES.length} indexes, ${probes.length} constraint probes rejected as expected.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
