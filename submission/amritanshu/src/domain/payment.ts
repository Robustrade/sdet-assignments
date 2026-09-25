export type PaymentStatus =
  | "succeeded"
  | "failed"
  | "refunded";

export interface Payment {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  providerReference?: string;
  createdAt: Date;
}