
export type InvoiceStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "timeout";

export interface Invoice {
  id: string;
  subscriptionId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  idempotencyKey: string;
  transactionId?: string;
  createdAt: Date;
  updatedAt: Date;
}
