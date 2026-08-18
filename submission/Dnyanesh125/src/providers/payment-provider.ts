export type PaymentOutcome = 'success' | 'declined' | 'timeout';

export interface PaymentRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  referenceId: string;
}

export interface PaymentResult {
  outcome: PaymentOutcome;
  providerPaymentId?: string;
  message?: string;
}

export interface PaymentProvider {
  charge(request: PaymentRequest): Promise<PaymentResult>;
}
