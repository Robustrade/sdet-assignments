import { Invoice } from "../domain/Invoice";
import { InvoiceRepository } from "./InvoiceRepository";

export class InMemoryInvoiceRepository
  implements InvoiceRepository {

  private invoices =
    new Map<string, Invoice>();

  save(invoice: Invoice): void {
    this.invoices.set(
      invoice.id,
      invoice
    );
  }

  findById(
    id: string
  ): Invoice | undefined {
    return this.invoices.get(id);
  }
}