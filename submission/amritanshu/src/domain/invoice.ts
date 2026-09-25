export type InvoiceStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded";

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  createdAt: Date;
}