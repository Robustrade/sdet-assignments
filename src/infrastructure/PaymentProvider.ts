export interface ChargeRequest {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<{ success: boolean; transactionId?: string; error?: string }>;
}
