export enum InvoiceStatus {
  OPEN = "open",
  PAID = "paid",
  FAILED = "failed",
  VOID = "void",
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountInCents: number;
  status: InvoiceStatus;
  createdAt: Date;
  paidAt?: Date;
}