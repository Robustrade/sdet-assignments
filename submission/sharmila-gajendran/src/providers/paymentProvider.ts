/**
 * The seam around the payment provider. The service only knows this interface;
 * production would plug in a real adapter, tests plug in a mock.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export interface ChargeRequest {
  readonly amountCents: number;
  readonly currency: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  /** The invoice id. The provider must not charge twice for the same key. */
  readonly idempotencyKey: string;
  /** The subscription id, so the provider's records point back to us. */
  readonly reference: string;
}

export type ChargeResult =
  | { readonly status: 'succeeded'; readonly chargeId: string }
  | { readonly status: 'declined'; readonly chargeId: string; readonly reason: string }
  /** Accepted, but the final result arrives later by webhook. */
  | { readonly status: 'pending'; readonly chargeId: string };

export class ProviderTimeoutError extends Error {
  constructor(message = 'Payment provider did not answer in time') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}
