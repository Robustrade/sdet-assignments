
import db from '../database/connection';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export class BillingRepository {
  constructor(private database: Database.Database = db) {}

  createInvoice(
    subscriptionId: string,
    amount: number,
    status = 'pending'
  ): string {
    const invoiceId = randomUUID();

    this.database.prepare(`
      INSERT INTO invoices (
        id,
        subscription_id,
        amount,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      subscriptionId,
      amount,
      status,
      new Date().toISOString()
    );

    return invoiceId;
  }

  createPayment(
    invoiceId: string,
    amount: number,
    status: string,
    transactionId?: string
  ): string {
    const paymentId = randomUUID();

    this.database.prepare(`
      INSERT INTO payments (
        id,
        invoice_id,
        transaction_id,
        amount,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      invoiceId,
      transactionId ?? null,
      amount,
      status,
      new Date().toISOString()
    );

    return paymentId;
  }

  updateInvoiceStatus(
    invoiceId: string,
    status: string
  ): void {
    this.database.prepare(`
      UPDATE invoices SET status = ? WHERE id = ?
    `).run(status, invoiceId);
  }
}
