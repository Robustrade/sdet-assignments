export type InvoiceStatus = "pending" | "succeeded" | "failed";

export type InvoiceFailureReason = "provider_declined" | "provider_timeout" | "payment_failed_webhook" | null;

/**
 * An invoice represents one billing attempt (initial charge, retry, or recurring charge).
 * `providerChargeId` is set once the provider *acknowledges* the attempt (see
 * SubscriptionService.attemptCharge) and is used as the idempotency/reference key we assert
 * against in provider-mock tests.
 */
export class Invoice {
  status: InvoiceStatus = "pending";
  providerChargeId: string | null = null;
  failureReason: InvoiceFailureReason = null;
  settledAt: Date | null = null;

  constructor(
    public readonly id: string,
    public readonly subscriptionId: string,
    public readonly amountCents: number,
    public readonly currency: string,
    public readonly createdAt: Date
  ) {}
}
