/**
 * Invoice repository backed by SQLite (sql.js).
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import { NotFoundError } from '../domain/errors.js';
import type { InvoiceRecord, InvoiceStatus } from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export interface CreateInvoiceInput {
  readonly id: string;
  readonly subscription_id: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly period_start: string;
  readonly period_end: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const INVOICE_COLUMNS =
  'id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at';

export class InvoiceRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public create(input: CreateInvoiceInput): InvoiceRecord {
    this.db.run(
      `INSERT INTO invoices (${INVOICE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.subscription_id,
        input.amount_cents,
        input.currency,
        input.status,
        input.period_start,
        input.period_end,
        input.created_at,
        input.updated_at,
      ],
    );
    return this.requireById(input.id);
  }

  public findById(id: string): InvoiceRecord | null {
    const row = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = ?`,
      [id],
    );
    return (row as unknown as InvoiceRecord | null);
  }

  public findLatestUnpaidForSubscription(subscriptionId: string): InvoiceRecord | null {
    const row = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE subscription_id = ? AND status IN ('pending', 'failed') ORDER BY rowid DESC LIMIT 1`,
      [subscriptionId],
    );
    return (row as unknown as InvoiceRecord | null);
  }

  public findBySubscriptionId(subscriptionId: string): InvoiceRecord[] {
    const rows = this.db.queryAll<Record<string, SqlValue>>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE subscription_id = ? ORDER BY rowid ASC`,
      [subscriptionId],
    );
    return rows as unknown as InvoiceRecord[];
  }

  public updateStatus(id: string, status: InvoiceStatus, updatedAt: string): InvoiceRecord {
    this.db.run(
      'UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?',
      [status, updatedAt, id],
    );
    return this.requireById(id);
  }

  private requireById(id: string): InvoiceRecord {
    const found = this.findById(id);
    if (!found) {
      throw new NotFoundError(`Invoice "${id}" not found`);
    }
    return found;
  }
}
