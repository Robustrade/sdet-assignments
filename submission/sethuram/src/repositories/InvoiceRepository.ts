
import { Invoice } from "../domain/Invoice";

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;

  findById(id: string): Promise<Invoice | null>;

  findBySubscriptionId(
    subscriptionId: string
  ): Promise<Invoice[]>;

  findByIdempotencyKey(
    key: string
  ): Promise<Invoice | null>;

  findAll(): Promise<Invoice[]>;
}
