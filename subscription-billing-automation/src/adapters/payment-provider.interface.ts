export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export type ChargeOutcome =
  | { kind: 'succeeded'; providerReference: string }
  | { kind: 'declined'; reason: string }
  | { kind: 'timeout' };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeOutcome>;
}
