export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  /** Unique per genuine billing attempt; replays reuse the same key. */
  idempotencyKey: string;
}

export type ChargeResult =
  | { outcome: 'success' }
  | { outcome: 'decline'; reason: string }
  | { outcome: 'timeout' };

/**
 * Seam around the payment provider (Strategy / dependency-injection seam).
 * The service depends only on this interface; tests inject a mock/fake.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
