import { Invoice } from '../../domain/subscription/types';

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
  findById(id: string): Promise<Invoice | null>;
  findBySubscriptionId(subscriptionId: string): Promise<Invoice[]>;
}
