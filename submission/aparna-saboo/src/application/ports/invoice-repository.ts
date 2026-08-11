import type { Invoice } from '../../domain/models/invoice';

export interface InvoiceRepository {
  findById(id: string): Invoice | undefined;
  save(invoice: Invoice): void;
  delete(id: string): void;
}
