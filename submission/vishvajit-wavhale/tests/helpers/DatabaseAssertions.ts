
import type BetterSqlite3 from 'better-sqlite3';
import { expect } from 'vitest';

export class DatabaseAssertions {
  constructor(private readonly db: BetterSqlite3.Database) {}

  assertRecordExists(
    table: string,
    column: string,
    value: string
  ): void {
    const allowedTables = [
      'customers',
      'plans',
      'subscriptions',
      'invoices',
      'webhook_events',
      'audit_logs'
    ];

    if (!allowedTables.includes(table)) {
      throw new Error(`Unsupported table: ${table}`);
    }

    const row = this.db
      .prepare(`SELECT 1 FROM "${table}" WHERE "${column}" = ?`)
      .get(value);

    expect(row).toBeDefined();
  }

  assertRecordDoesNotExist(
    table: string,
    column: string,
    value: string
  ): void {
    const allowedTables = [
      'customers',
      'plans',
      'subscriptions',
      'invoices',
      'webhook_events',
      'audit_logs'
    ];

    if (!allowedTables.includes(table)) {
      throw new Error(`Unsupported table: ${table}`);
    }

    const row = this.db
      .prepare(`SELECT 1 FROM "${table}" WHERE "${column}" = ?`)
      .get(value);

    expect(row).toBeUndefined();
  }

  assertRecordCount(
    table: string,
    expectedCount: number
  ): void {
    const allowedTables = [
      'customers',
      'plans',
      'subscriptions',
      'invoices',
      'webhook_events',
      'audit_logs'
    ];

    if (!allowedTables.includes(table)) {
      throw new Error(`Unsupported table: ${table}`);
    }

    const result = this.db
      .prepare(`SELECT COUNT(*) AS count FROM "${table}"`)
      .get() as { count: number };

    expect(result.count).toBe(expectedCount);
  }

  assertColumnValue(
    table: string,
    idColumn: string,
    id: string,
    column: string,
    expectedValue: string
  ): void {
    const allowedTables = [
      'customers',
      'plans',
      'subscriptions',
      'invoices',
      'webhook_events',
      'audit_logs'
    ];

    if (!allowedTables.includes(table)) {
      throw new Error(`Unsupported table: ${table}`);
    }

    const row = this.db
      .prepare(
        `SELECT "${column}" FROM "${table}" WHERE "${idColumn}" = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.[column]).toBe(expectedValue);
  }
}
