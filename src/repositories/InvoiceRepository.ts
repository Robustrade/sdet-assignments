import { Invoice } from "../domain/Invoice";

export interface InvoiceRepository {
  save(invoice: Invoice): void;

  findById(
    id: string
  ): Invoice | undefined;
}