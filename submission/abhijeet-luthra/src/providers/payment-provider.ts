/**
 * The seam around the external payment provider (assignment "Required Design
 * Patterns": interface + dependency injection).
 *
 * The billing service depends ONLY on this interface. Tests inject a mock that
 * records calls and returns scripted outcomes; a real HTTP client would be one
 * more implementation of the same interface. No real provider exists here.
 */
export interface ChargeRequest {
  /** Unique per payment attempt (`<invoice_id>:<attempt_number>`), so the provider can de-duplicate. */
  idempotencyKey: string;
  invoiceId: string;
  customerId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: string;
}

export type ChargeResult =
  | { outcome: 'succeeded'; providerReference: string }
  | { outcome: 'declined'; providerReference: string; declineCode: string };

/**
 * Thrown when the provider does not answer in time. The outcome is UNKNOWN: the
 * customer may or may not have been charged, so it must never be treated as a decline.
 */
export class ProviderTimeoutError extends Error {
  constructor(message = 'Payment provider timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
