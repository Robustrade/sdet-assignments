export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export type ChargeResult =
  | { outcome: 'succeeded'; providerRef: string }
  | { outcome: 'declined'; reason: string };

export class ProviderTimeoutError extends Error {
  constructor() {
    super('Payment provider timed out');
  }
}

/** The seam: production would implement this over HTTP; tests inject a fake. */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
