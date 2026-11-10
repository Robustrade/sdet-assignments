/**
 * In-Memory Invoice Repository
 */

import { Invoice, InvoiceStatus } from '../../domain/subscription/types';
import { InMemoryDatabase } from './InMemoryDatabase';
import { InvoiceRepository } from './InvoiceRepository';

export class InMemoryInvoiceRepository implements InvoiceRepository {
  constructor(private db: InMemoryDatabase) {}

  async save(invoice: Invoice): Promise<void> {
    this.db.invoices.set(invoice.id, { ...invoice });
  }

  async findById(id: string): Promise<Invoice | null> {
    const invoice = this.db.invoices.get(id);
    return invoice ? { ...invoice } : null;
  }

  async findBySubscriptionId(subscriptionId: string): Promise<Invoice[]> {
    return Array.from(this.db.invoices.values())
      .filter((inv) => inv.subscription_id === subscriptionId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  updateStatus(id: string, status: InvoiceStatus, paidAt?: Date): void {
    const invoice = this.db.invoices.get(id);
    if (invoice) {
      invoice.status = status;
      if (paidAt) {
        invoice.paid_at = paidAt;
      }
      this.db.invoices.set(id, invoice);
    }
  }
}
