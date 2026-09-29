/**
 * The seam around the external payment provider. The service depends only on this
 * interface; tests inject MockPaymentProvider, production would inject an HTTP adapter.
 */
export interface ChargeRequest {
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly amount: number;
  readonly currency: string;
  /** Provider-side dedupe key: retrying the same attempt must never charge twice. */
  readonly idempotencyKey: string;
  /** Echoed back by the provider on webhooks, like Stripe charge metadata. */
  readonly metadata: { readonly subscriptionId: string; readonly invoiceId: string };
}

export type ChargeResult =
  | { readonly status: 'succeeded'; readonly providerRef: string }
  | { readonly status: 'declined'; readonly providerRef: string; readonly declineCode: string };

export interface PaymentProvider {
  /** Resolves with the provider's verdict, or rejects with ProviderTimeoutError when the outcome is unknown. */
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class ProviderTimeoutError extends Error {
  override readonly name = 'ProviderTimeoutError';
}
