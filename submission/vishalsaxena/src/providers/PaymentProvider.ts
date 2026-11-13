export interface PaymentRequest {
  invoiceId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentResult {
  success: boolean;
  providerPaymentId: string;
  message: string;
}

export interface PaymentProvider {
  charge(request: PaymentRequest): Promise<PaymentResult>;
}