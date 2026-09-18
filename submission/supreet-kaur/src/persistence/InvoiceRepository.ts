import { InMemoryDatabase } from "./InMemoryDatabase";
import { Invoice } from "../domain/Invoice";

export class InvoiceRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  save(invoice: Invoice): void {
    this.db.invoices.set(invoice.id, invoice);
  }

  findById(id: string): Invoice | undefined {
    return this.db.invoices.get(id);
  }

  findBySubscriptionId(subscriptionId: string): Invoice[] {
    return Array.from(this.db.invoices.values())
      .filter((inv) => inv.subscriptionId === subscriptionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
