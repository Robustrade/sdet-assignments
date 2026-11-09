/**
 * The seam around the external payment provider.
 *
 * The service depends only on this interface, never on a concrete HTTP client.
 * Production would inject an adapter that talks to Stripe/Adyen/etc.; tests
 * inject a fake that records calls and returns configurable outcomes. This is
 * the dependency-injection / Strategy seam the assignment asks for: it is what
 * lets us assert on call count and arguments and simulate decline/timeout
 * without a real network.
 */

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  /** Amount in the smallest currency unit (e.g. cents). */
  amount: number;
  currency: string;
  /**
   * Idempotency / reference key for this charge. The service uses the invoice id
   * so a retried charge for the same invoice is safe at the provider too.
   */
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  /** Present on success — the provider's reference for the charge. */
  providerChargeId?: string;
  /** Present on a soft decline (e.g. card_declined, insufficient_funds). */
  failureCode?: string;
}

/** Thrown to model a hard failure such as a network timeout from the provider. */
export class PaymentProviderTimeoutError extends Error {
  constructor(message = 'payment provider timed out') {
    super(message);
    this.name = 'PaymentProviderTimeoutError';
  }
}

export interface PaymentProvider {
  /**
   * Attempt to charge the customer. Resolves with success/decline; rejects with
   * {@link PaymentProviderTimeoutError} (or any error) to model a hard failure.
   */
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
