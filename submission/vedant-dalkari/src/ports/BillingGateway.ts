/**
 * External payment gateway seam interface.
 * Author: Vedant Dalkari
 */

export interface ChargeRequest {
  readonly customerId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  readonly idempotencyKey: string;
}

export type ChargeResult =
  | { readonly status: 'approved'; readonly providerReference: string }
  | { readonly status: 'declined'; readonly reason: string }
  | { readonly status: 'timeout'; readonly reason: string };

export interface BillingGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
