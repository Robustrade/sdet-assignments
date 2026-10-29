export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/**
 * One billing attempt. `paid`, `failed` and `refunded` are terminal for incoming events:
 * only a `pending` invoice can be resolved by a charge result, and only a `paid` one can be refunded.
 */
export interface InvoiceRecord {
  readonly id: string;
  readonly subscriptionId: string;
  /** Minor units (cents). */
  readonly amount: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  /** 1-based billing attempt number within the subscription. */
  readonly attempt: number;
  /** Unique per billing attempt; what the provider deduplicates on. */
  readonly idempotencyKey: string;
  readonly providerChargeId?: string;
  readonly declineCode?: string;
  /** ISO-8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
}
