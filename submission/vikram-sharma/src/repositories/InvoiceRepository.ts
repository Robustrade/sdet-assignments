import { db } from "../database/database";

export class InvoiceRepository {

    create(invoice: { id: string; subscriptionId: string; amount: number; currency: string; status: string }) {
        const stmt = db.prepare(`INSERT INTO invoices (id, subscription_id, amount, currency, status, attempts) VALUES (?, ?, ?, ?, ?, 0)`);
        stmt.run(invoice.id, invoice.subscriptionId, invoice.amount, invoice.currency, invoice.status);
    }

    findById(id: string) {
        const stmt = db.prepare(`SELECT * FROM invoices WHERE id = ?`);
        return stmt.get(id);
    }

    incrementAttempts(id: string) {
        const stmt = db.prepare(`UPDATE invoices SET attempts = attempts + 1 WHERE id = ?`);
        stmt.run(id);
    }

    countForSubscription(subscriptionId: string) {
        const stmt = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE subscription_id = ?`);
        const row = stmt.get(subscriptionId);
        return row ? row.c : 0;
    }

}
