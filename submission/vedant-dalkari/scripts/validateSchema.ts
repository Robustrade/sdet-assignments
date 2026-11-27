/**
 * Schema DDL validation script verifying table creation, columns, FK, and PK constraints.
 * Author: Vedant Dalkari
 */

import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { SqliteDatabase } from '../src/persistence/SqliteDatabase.js';

export interface SchemaValidationReport {
  readonly tables: readonly string[];
  readonly foreignKeyEnforced: boolean;
  readonly primaryKeyEnforced: boolean;
}

const EXPECTED_TABLES = [
  'customers',
  'invoices',
  'payment_attempts',
  'subscription_audit_log',
  'subscriptions',
  'webhook_events',
] as const;

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(THIS_DIR, '..');
const WASM_DIR = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');

export async function validateSchema(): Promise<SchemaValidationReport> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(WASM_DIR, file),
  });
  const rawDb = new SQL.Database();
  const db = new SqliteDatabase(rawDb);

  try {
    db.initializeSchema();

    const tableRows = db.queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const tables = tableRows.map((r) => r.name);

    for (const required of EXPECTED_TABLES) {
      if (!tables.includes(required)) {
        throw new Error(`Missing required table "${required}" in schema.sql`);
      }
      const cols = db.queryAll<{ name: string }>(`PRAGMA table_info(${required})`);
      if (cols.length === 0) {
        throw new Error(`Table "${required}" has zero columns`);
      }
    }

    let foreignKeyEnforced = false;
    try {
      db.run(
        `INSERT INTO subscriptions (id, customer_id, plan, status, payment_method_id, failed_attempts, trial_ends_at, current_period_start, current_period_end, canceled_at, created_at, updated_at)
         VALUES ('sub_fk_probe', 'cust_ghost', 'starter', 'active', 'pm_probe', 0, NULL, '2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
    } catch (error) {
      if (error instanceof Error && /FOREIGN KEY/i.test(error.message)) {
        foreignKeyEnforced = true;
      } else {
        throw error;
      }
    }
    if (!foreignKeyEnforced) {
      throw new Error('Foreign key enforcement check failed for cust_ghost');
    }

    db.run(
      `INSERT INTO webhook_events (event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at)
       VALUES ('evt_pk_1', 'payment.succeeded', NULL, NULL, 'processed', 'hash_probe', '2026-01-01T00:00:00.000Z')`,
    );

    let primaryKeyEnforced = false;
    try {
      db.run(
        `INSERT INTO webhook_events (event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at)
         VALUES ('evt_pk_1', 'payment.succeeded', NULL, NULL, 'processed', 'hash_probe', '2026-01-01T00:00:01.000Z')`,
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        primaryKeyEnforced = true;
      } else {
        throw error;
      }
    }
    if (!primaryKeyEnforced) {
      throw new Error('Primary key uniqueness check failed for evt_pk_1');
    }

    return {
      tables,
      foreignKeyEnforced,
      primaryKeyEnforced,
    };
  } finally {
    db.close();
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  validateSchema()
    .then((report) => {
      console.log(
        `[validate-schema] OK: tables=[${report.tables.join(', ')}] fk=${String(report.foreignKeyEnforced)} pk=${String(report.primaryKeyEnforced)}`,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[validate-schema] FAILED: ${message}`);
      process.exitCode = 1;
    });
}
