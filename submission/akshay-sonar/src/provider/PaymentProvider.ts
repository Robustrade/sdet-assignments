export type PaymentOutcome =
  | "success"
  | "decline"
  | "timeout";

export interface PaymentRequest {
  subscriptionId: string;
  invoiceId: string;
  amountInCents: number;
}

export interface PaymentResult {
  success: boolean;
  providerPaymentId: string;
  outcome: PaymentOutcome;
}

export interface PaymentProvider {
  charge(request: PaymentRequest): Promise<PaymentResult>;
}