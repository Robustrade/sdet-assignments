export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  reference: string;
  failureReason?: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
