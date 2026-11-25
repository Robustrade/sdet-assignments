
import { Invoice } from "../domain/Invoice";
import { InvoiceRepository } from "./InvoiceRepository";

export class InMemoryInvoiceRepository
  implements InvoiceRepository {

  private readonly invoices = new Map<string, Invoice>();

  async save(invoice: Invoice): Promise<void> {
    const existing = await this.findByIdempotencyKey(
      invoice.idempotencyKey
    );

    if (existing && existing.id !== invoice.id) {
      throw new Error("Duplicate billing attempt");
    }

    this.invoices.set(invoice.id, structuredClone(invoice));
  }

  async findById(id: string): Promise<Invoice | null> {
    const invoice = this.invoices.get(id);
    return invoice ? structuredClone(invoice) : null;
  }

  async findBySubscriptionId(
    subscriptionId: string
  ): Promise<Invoice[]> {
    return (await this.findAll()).filter(
      invoice => invoice.subscriptionId === subscriptionId
    );
  }

  async findByIdempotencyKey(
    key: string
  ): Promise<Invoice | null> {
    return (await this.findAll()).find(
      invoice => invoice.idempotencyKey === key
    ) ?? null;
  }

  async findAll(): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .map(invoice => structuredClone(invoice));
  }
}
