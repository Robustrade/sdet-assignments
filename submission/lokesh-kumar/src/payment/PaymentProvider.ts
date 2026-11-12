export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  outcome: 'succeeded' | 'declined';
  chargeId: string;
  declineReason?: string;
}

/** Thrown when the provider did not answer in time: the outcome of the charge is unknown. */
export class ProviderTimeoutError extends Error {
  constructor() {
    super('Payment provider timed out');
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * The seam around the external payment provider. The service only ever depends on this
 * interface, so tests inject a fake instead of making a network call.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
