import type { Invoice } from "../domain/invoice.js";

export interface InvoiceRepository {
  save(invoice: Invoice): void;
  findById(id: string): Invoice | undefined;
  findBySubscriptionId(subscriptionId: string): Invoice[];
}