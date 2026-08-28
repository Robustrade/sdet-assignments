import type { Invoice } from '../../domain/models/invoice';
import type { InvoiceRepository } from '../../application/ports/invoice-repository';

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly invoices = new Map<string, Invoice>();

  findById(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  save(invoice: Invoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  delete(id: string): void {
    this.invoices.delete(id);
  }
}
