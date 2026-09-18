/**
 * The seam around the external payment provider.
 *
 * Production wires an HTTP adapter; tests wire a recording fake. Nothing in the
 * billing engine knows which one it has.
 */
export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  /** Stable per invoice: the provider must never double-charge a retried call. */
  idempotencyKey: string;
  reference: {
    subscriptionId: string;
    invoiceId: string;
    attempt: number;
  };
}

export type ChargeResult =
  | { outcome: 'succeeded'; chargeId: string }
  | { outcome: 'declined'; declineCode: string };

/** A timeout is *not* a decline: the charge may still have happened upstream. */
export class PaymentProviderTimeoutError extends Error {
  constructor(message = 'payment provider timed out') {
    super(message);
    this.name = 'PaymentProviderTimeoutError';
  }
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
