
import { AppDatabase } from '../database/database';
import { Invoice, InvoiceStatus } from '../models/Invoice';

export class InvoiceRepository {
  constructor(private db: AppDatabase) {}

  create(invoice: Invoice): void {
    this.db.run(
      `INSERT INTO invoices
       (id, subscription_id, amount_cents, currency, status,
        billing_period_start, billing_period_end)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice.id,
        invoice.subscriptionId,
        invoice.amountCents,
        invoice.currency,
        invoice.status,
        invoice.billingPeriodStart,
        invoice.billingPeriodEnd
      ]
    );
  }

  findById(id: string): Invoice | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM invoices WHERE id = ?`
    );

    try {
      statement.bind([id]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        id: row.id as string,
        subscriptionId: row.subscription_id as string,
        amountCents: row.amount_cents as number,
        currency: row.currency as string,
        status: row.status as InvoiceStatus,
        billingPeriodStart: row.billing_period_start as string,
        billingPeriodEnd: row.billing_period_end as string,
        createdAt: row.created_at as string
      };
    } finally {
      statement.free();
    }
  }

  updateStatus(id: string, status: InvoiceStatus): void {
    this.db.run(
      `UPDATE invoices SET status = ? WHERE id = ?`,
      [status, id]
    );

    if (this.db.getRowsModified() === 0) {
      throw new Error(`Invoice not found: ${id}`);
    }
  }
}
