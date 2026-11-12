export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Things that can happen to a subscription. The state machine decides what each one does. */
export const LIFECYCLE_TRIGGERS = ['charge_succeeded', 'charge_failed', 'retries_exhausted', 'cancel_requested'] as const;
export type LifecycleTrigger = (typeof LIFECYCLE_TRIGGERS)[number];

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

/** Where a change came from, kept in the audit log. */
export type ChangeSource = 'api' | 'billing' | 'webhook';

export interface Customer {
  readonly id: string;
  readonly email: string;
}

export interface PaymentMethod {
  readonly id: string;
  readonly customerId: string;
}

export interface Subscription {
  readonly id: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly plan: string;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: string;
  readonly currentPeriodEnd: string | null;
  readonly canceledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One row per billing attempt. Its id is also the idempotency key sent to the provider. */
export interface Invoice {
  readonly id: string;
  readonly subscriptionId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly idempotencyKey: string;
  readonly providerChargeId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'ignored_stale'
  | 'ignored_invalid_transition'
  | 'ignored_unknown_reference';

/** Duplicates are never stored, so a stored event always has one of these outcomes. */
export type StoredWebhookOutcome = Exclude<WebhookOutcome, 'duplicate'>;

export interface WebhookEventRecord {
  readonly eventId: string;
  readonly type: string;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly outcome: StoredWebhookOutcome;
  readonly receivedAt: string;
}

/**
 * created    – the subscription was created
 * transition – the status changed (always one of the allowed transitions)
 * event      – something worth recording happened without a status change (renewal, failed retry, refund)
 */
export type AuditKind = 'created' | 'transition' | 'event';

export interface AuditEntry {
  readonly id: number;
  readonly subscriptionId: string;
  readonly kind: AuditKind;
  readonly fromStatus: SubscriptionStatus | null;
  readonly toStatus: SubscriptionStatus;
  readonly trigger: string;
  readonly source: ChangeSource;
  readonly reference: string | null;
  readonly createdAt: string;
}
