export interface ChargeRequest {
  customerId: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  idempotencyKey: string;
}

export type ChargeStatus = 'succeeded' | 'declined' | 'timeout';

export interface ChargeResult {
  status: ChargeStatus;
  providerRef: string;
}

export interface PaymentProviderPort {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}