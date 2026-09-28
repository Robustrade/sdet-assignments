import type { Currency } from '../domain/types';

/**
 * PATTERN: Port / Adapter seam (dependency injection).
 *
 * The service only ever talks to this interface. Production would inject an
 * HTTP adapter for the real provider; tests inject MockPaymentProvider.
 */
export interface ChargeRequest {
  amount: number;
  currency: Currency;
  customerId: string;
  paymentMethodId: string;
  subscriptionId: string;
  invoiceId: string;
  /** Unique per billing attempt so the provider can dedupe retries of the same call. */
  idempotencyKey: string;
}

export type ChargeResult =
  | { outcome: 'succeeded'; providerChargeId: string }
  | { outcome: 'declined'; declineCode: string };

/** Thrown when the provider did not answer in time: the outcome is UNKNOWN. */
export class PaymentProviderTimeoutError extends Error {
  constructor(message = 'Payment provider timed out') {
    super(message);
    this.name = 'PaymentProviderTimeoutError';
  }
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
