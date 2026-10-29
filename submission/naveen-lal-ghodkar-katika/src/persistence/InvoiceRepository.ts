import type { InvoiceRecord } from '../domain/Invoice';

export interface InvoiceRepository {
  /** Insert or replace by id. */
  save(invoice: InvoiceRecord): Promise<void>;
  findById(id: string): Promise<InvoiceRecord | undefined>;
  /** Invoices of one subscription, ordered by attempt number (oldest first). */
  listBySubscription(subscriptionId: string): Promise<InvoiceRecord[]>;
  list(): Promise<InvoiceRecord[]>;
}
