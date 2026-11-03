/**
 * The seam around the external payment provider. The service depends only on this
 * interface; production would plug in an HTTP adapter, tests plug in a mock.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  /** Unique per attempt: the provider must not charge twice for the same key. */
  idempotencyKey: string;
  /** Our invoice id, echoed back on webhooks. */
  reference: string;
}

export type ChargeResult =
  | { status: 'succeeded'; chargeId: string }
  | { status: 'declined'; chargeId: string; declineCode: string }
  /** Accepted, final outcome will arrive by webhook. */
  | { status: 'pending'; chargeId: string };

/** The provider did not answer in time. Whether money moved is unknown. */
export class ProviderTimeoutError extends Error {
  constructor(message = 'Payment provider timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}
