import { Db } from '../db/database';
import { Invoice, InvoiceStatus } from '../domain/types';

const COLUMNS = `id, subscription_id AS subscriptionId, amount_minor AS amountMinor, currency, status,
  period_start AS periodStart, period_end AS periodEnd, created_at AS createdAt, updated_at AS updatedAt`;

export class InvoiceRepository {
  constructor(private readonly db: Db) {}

  insert(invoice: Invoice): void {
    this.db
      .prepare(
        `INSERT INTO invoices (id, subscription_id, amount_minor, currency, status, period_start, period_end,
           created_at, updated_at)
         VALUES (@id, @subscriptionId, @amountMinor, @currency, @status, @periodStart, @periodEnd,
           @createdAt, @updatedAt)`,
      )
      .run(invoice);
  }

  updateStatus(id: string, status: InvoiceStatus, now: string): void {
    this.db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  findById(id: string): Invoice | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM invoices WHERE id = ?`).get(id) as Invoice | undefined;
  }

  /** Oldest first, so tests can reason about billing order. */
  findBySubscription(subscriptionId: string): Invoice[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM invoices WHERE subscription_id = ? ORDER BY created_at, id`)
      .all(subscriptionId) as Invoice[];
  }

  findOpenBySubscription(subscriptionId: string): Invoice | undefined {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM invoices WHERE subscription_id = ? AND status = 'open' ORDER BY created_at DESC, id DESC`)
      .get(subscriptionId) as Invoice | undefined;
  }
}
