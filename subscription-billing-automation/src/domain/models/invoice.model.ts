export type InvoiceStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  providerReference?: string;
  createdAt: string;
}
