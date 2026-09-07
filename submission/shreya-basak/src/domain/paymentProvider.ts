export type ChargeOutcome = 'succeeded' | 'declined' | 'timeout';

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  outcome: ChargeOutcome;
  providerChargeId: string | null;
}


export interface PaymentProviderClient {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
