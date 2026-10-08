import { Invoice } from '../domain/models/invoice.model';

export class InvoiceRepository {
  private readonly records = new Map<string, Invoice>();

  save(invoice: Invoice): void {
    this.records.set(invoice.id, { ...invoice });
  }

  findById(id: string): Invoice | undefined {
    const invoice = this.records.get(id);
    return invoice ? { ...invoice } : undefined;
  }

  findBySubscriptionId(subscriptionId: string): Invoice[] {
    return [...this.records.values()]
      .filter((invoice) => invoice.subscriptionId === subscriptionId)
      .map((invoice) => ({ ...invoice }));
  }

  all(): Invoice[] {
    return [...this.records.values()].map((invoice) => ({ ...invoice }));
  }
}
