import type { InvoiceRecord } from '../domain/Invoice';
import type { InvoiceRepository } from './InvoiceRepository';

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly rows = new Map<string, InvoiceRecord>();

  async save(invoice: InvoiceRecord): Promise<void> {
    this.rows.set(invoice.id, { ...invoice });
  }

  async findById(id: string): Promise<InvoiceRecord | undefined> {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  async listBySubscription(subscriptionId: string): Promise<InvoiceRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.subscriptionId === subscriptionId)
      .sort((a, b) => a.attempt - b.attempt)
      .map((row) => ({ ...row }));
  }

  async list(): Promise<InvoiceRecord[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}
