
import { AppDatabase } from '../database/database';
import { Payment, PaymentStatus } from '../models/Payment';

export class PaymentRepository {
  constructor(private db: AppDatabase) {}

  create(payment: Payment): void {
    this.db.run(
      `INSERT INTO payments
       (id, invoice_id, amount_cents, status)
       VALUES (?, ?, ?, ?)`,
      [
        payment.id,
        payment.invoiceId,
        payment.amountCents,
        payment.status
      ]
    );
  }

  findById(id: string): Payment | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM payments WHERE id = ?`
    );

    try {
      statement.bind([id]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        id: row.id as string,
        invoiceId: row.invoice_id as string,
        providerPaymentId: row.provider_payment_id as string | undefined,
        amountCents: row.amount_cents as number,
        status: row.status as PaymentStatus,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      };
    } finally {
      statement.free();
    }
  }

  updateStatus(
    id: string,
    status: PaymentStatus,
    providerPaymentId?: string
  ): void {
    this.db.run(
      `UPDATE payments
       SET status = ?,
           provider_payment_id = COALESCE(?, provider_payment_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, providerPaymentId ?? null, id]
    );

    if (this.db.getRowsModified() === 0) {
      throw new Error(`Payment not found: ${id}`);
    }
  }


  findByInvoiceId(invoiceId: string): Payment | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM payments
       WHERE invoice_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    );

    try {
      statement.bind([invoiceId]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        id: row.id as string,
        invoiceId: row.invoice_id as string,
        providerPaymentId: row.provider_payment_id as string | undefined,
        amountCents: row.amount_cents as number,
        status: row.status as PaymentStatus,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string
      };
    } finally {
      statement.free();
    }
  }
}
