/**
 * The seam between the billing service and the outside world's payment provider.
 * The service only ever talks to this interface, so tests inject a double and no network is involved.
 */

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  /** Minor units (cents), taken from the plan price. */
  amount: number;
  currency: string;
  /**
   * Stable per billing attempt: sending the same request twice (e.g. a retry after a timeout)
   * must not charge twice. The provider is expected to deduplicate on this value.
   */
  idempotencyKey: string;
  /** Our own identifier for what is being paid (the subscription id), echoed in provider dashboards. */
  reference: string;
}

export type ChargeResult =
  | { status: 'succeeded'; providerChargeId: string }
  | { status: 'declined'; declineCode: string };

/** The provider did not answer in time: the charge may or may not have happened. */
export class ProviderTimeoutError extends Error {
  constructor(message = 'Payment provider timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export interface PaymentProvider {
  /** Resolves with the provider's decision, or rejects with `ProviderTimeoutError` when the outcome is unknown. */
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
