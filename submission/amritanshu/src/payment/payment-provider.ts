export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  providerReference: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}