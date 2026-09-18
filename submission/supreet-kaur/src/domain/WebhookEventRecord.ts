export type WebhookProcessingOutcome =
  | "applied" // first delivery, caused (or attempted) a state change
  | "duplicate" // event_id already seen -- no-op by design
  | "ignored" // valid + new, but the current state chose to ignore it (e.g. already canceled)
  | "rejected_signature" // bad/missing HMAC signature
  | "rejected_malformed"; // payload failed shape validation

/**
 * One row per inbound webhook *delivery attempt* (not per unique event) -- duplicates are
 * still recorded, with outcome "duplicate", so the audit trail shows that Stripe-the-mock
 * retried us and we correctly no-op'd, which is itself something we want to prove in tests.
 */
export class WebhookEventRecord {
  constructor(
    public readonly deliveryId: string, // unique per HTTP delivery, distinct from event_id
    public readonly eventId: string | null, // null when payload was too malformed to even have one
    public readonly type: string | null,
    public readonly subscriptionId: string | null,
    public readonly invoiceId: string | null,
    public readonly receivedAt: Date,
    public readonly outcome: WebhookProcessingOutcome
  ) {}
}
