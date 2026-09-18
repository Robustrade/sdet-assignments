/**
 * Strategy/Adapter seam around the external payment provider.
 *
 * SubscriptionService depends only on this interface (constructor-injected -- see
 * SubscriptionService.ts), never on a concrete provider. In production you would implement
 * `StripeAdapter implements PaymentProvider` and adapt Stripe's SDK shape to this one; for
 * this assignment the only implementation is MockPaymentProvider, which the tests configure
 * per-scenario and assert against (call count, arguments). That substitution is the entire
 * point of the pattern: SubscriptionService never knows or cares that it's talking to a fake.
 */

export interface ChargeRequest {
  readonly customerId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  /** Passed through to the provider so retried attempts with the same key don't double-charge on their end either. */
  readonly idempotencyKey: string;
}

export interface ChargeAcceptance {
  /** The provider's own reference for this attempt. Final success/failure still arrives via webhook. */
  readonly providerChargeId: string;
}

/** Synchronous decline at authorization time (e.g. invalid card) -- distinct from an async payment.failed webhook. */
export class ProviderDeclinedError extends Error {
  constructor(message = "Payment provider declined the charge at authorization time") {
    super(message);
    this.name = "ProviderDeclinedError";
  }
}

/** The provider did not respond in time / was unreachable. */
export class ProviderTimeoutError extends Error {
  constructor(message = "Payment provider request timed out") {
    super(message);
    this.name = "ProviderTimeoutError";
  }
}

export interface PaymentProvider {
  /**
   * Submits a charge attempt. Resolves with an acknowledgement if the provider accepted the
   * attempt for processing (final settlement arrives later via webhook). Rejects with
   * ProviderDeclinedError or ProviderTimeoutError if the attempt could not even be submitted.
   */
  charge(request: ChargeRequest): Promise<ChargeAcceptance>;
}
