export enum PaymentStatus {
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  REFUNDED = "refunded",
}

export interface Payment {
  id: string;
  invoiceId: string;
  subscriptionId: string;
  amountInCents: number;
  status: PaymentStatus;
  providerPaymentId: string;
  createdAt: Date;
}