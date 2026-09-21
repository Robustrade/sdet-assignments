import type { DatabaseSync } from 'node:sqlite';
import type { Invoice, InvoiceState } from '../../domain/Invoice.js';

interface InvoiceRow {
    id: string;
    subscription_id: string;
    amount: number;
    currency: string;
    status: InvoiceState;
}

export class InvoiceRepository {
    constructor(private readonly db: DatabaseSync) { }

    create(invoice: Invoice): void {
        this.db
            .prepare(`
        INSERT INTO invoices (
          id,
          subscription_id,
          amount,
          currency,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `)
            .run(
                invoice.id,
                invoice.subscriptionId,
                invoice.amount,
                invoice.currency,
                invoice.status
            );
    }

    getById(id: string): Invoice | undefined {
        const row = this.db
            .prepare(`
        SELECT
          id,
          subscription_id,
          amount,
          currency,
          status
        FROM invoices
        WHERE id = ?
      `)
            .get(id) as InvoiceRow | undefined;

        return row ? this.toDomain(row) : undefined;
    }

    getBySubscriptionId(subscriptionId: string): Invoice[] {
        const rows = this.db
            .prepare(`
        SELECT
          id,
          subscription_id,
          amount,
          currency,
          status
        FROM invoices
        WHERE subscription_id = ?
        ORDER BY rowid
      `)
            .all(subscriptionId) as unknown as InvoiceRow[];

        return rows.map((row) => this.toDomain(row));
    }

    updateStatus(id: string, status: InvoiceState): void {
        this.db
            .prepare(`
        UPDATE invoices
        SET status = ?
        WHERE id = ?
      `)
            .run(status, id);
    }

    private toDomain(row: InvoiceRow): Invoice {
        return {
            id: row.id,
            subscriptionId: row.subscription_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
        };
    }
}