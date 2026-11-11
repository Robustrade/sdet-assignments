
import Database from 'better-sqlite3';

export type InvoicePaymentStatus =
    | 'succeeded'
    | 'failed'
    | 'refunded';

export class InvoicePaymentRepository {
    constructor(private readonly db: Database.Database) {}

    getStatus(invoiceId: string): InvoicePaymentStatus | undefined {
        const row = this.db.prepare(`
            SELECT status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get(invoiceId) as
            | { status: InvoicePaymentStatus }
            | undefined;

        return row?.status;
    }

    recordOutcome(
        invoiceId: string,
        subscriptionId: string,
        nextStatus: InvoicePaymentStatus
    ): boolean {
        if (!invoiceId || !subscriptionId) {
            throw new Error('Invoice ID and subscription ID are required');
        }

        const existing = this.db.prepare(`
            SELECT subscription_id, status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get(invoiceId) as
            | {
            subscription_id: string;
            status: InvoicePaymentStatus;
        }
            | undefined;

        if (existing && existing.subscription_id !== subscriptionId) {
            throw new Error('Invoice does not belong to this subscription');
        }

        // A successful payment cannot be downgraded to failed.
        if (
            existing?.status === 'succeeded' &&
            nextStatus === 'failed'
        ) {
            return false;
        }

        // A refunded invoice cannot become successful or failed again.
        if (existing?.status === 'refunded') {
            return false;
        }

        // A refund can only be recorded for a previously successful payment.
        if (nextStatus === 'refunded' && existing?.status !== 'succeeded') {
            return false;
        }

        this.db.prepare(`
            INSERT INTO invoice_payment_status
                (invoice_id, subscription_id, status, updated_at)
            VALUES (?, ?, ?, ?)
                ON CONFLICT(invoice_id) DO UPDATE SET
                status = excluded.status,
                                               updated_at = excluded.updated_at
        `).run(
            invoiceId,
            subscriptionId,
            nextStatus,
            new Date().toISOString()
        );

        return true;
    }
}
