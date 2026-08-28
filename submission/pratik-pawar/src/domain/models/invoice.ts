import type { CurrencyCode } from './subscription';

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: CurrencyCode;
  status: InvoiceStatus;
  createdAt: string;
}
