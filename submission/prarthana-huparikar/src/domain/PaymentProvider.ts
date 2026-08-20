export type ChargeOutcome = 'success' | 'decline';

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  /** Idempotency / correlation reference for this specific billing attempt. */
  reference: string;
}

export interface ChargeResult {
  outcome: ChargeOutcome;
  providerChargeId?: string;
}

/**
 * The seam between the service and the external payment provider. The
 * fixture's business logic depends on this interface only - never on a
 * concrete HTTP client - so tests can substitute MockPaymentProvider
 * instead of making a real network call.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
