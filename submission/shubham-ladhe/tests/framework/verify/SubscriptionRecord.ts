import { AuditEntry, ChargeAttempt, Invoice, Notification, Subscription, SubscriptionStatus, WebhookEventRecord } from '../../../src/domain/types';
import { Repositories } from '../../../src/persistence/repositories';
import { SubscriptionBody } from '../api/contracts';

/**
 * Everything persisted about one subscription, read through the repositories at one point in time.
 * Gives tests a readable way to talk about stored state ("status history", "latest invoice")
 * instead of reaching into tables.
 */
export class SubscriptionRecord {
  private constructor(
    readonly subscription: Subscription,
    readonly invoices: Invoice[],
    readonly attempts: ChargeAttempt[],
    readonly audit: AuditEntry[],
    readonly webhookEvents: WebhookEventRecord[],
    readonly notifications: Notification[],
  ) {}

  static load(repos: Repositories, subscriptionId: string): SubscriptionRecord {
    const subscription = repos.subscriptions.findById(subscriptionId);
    if (!subscription) throw new Error(`No subscription ${subscriptionId} in the database`);
    const invoices = repos.invoices.findBySubscription(subscriptionId);
    return new SubscriptionRecord(
      subscription,
      invoices,
      invoices.flatMap((i) => repos.attempts.findByInvoice(i.id)),
      repos.audit.findBySubscription(subscriptionId),
      repos.webhookEvents.findBySubscription(subscriptionId),
      repos.notifications.findBySubscription(subscriptionId),
    );
  }

  get status(): SubscriptionStatus {
    return this.subscription.status;
  }

  get latestInvoice(): Invoice | undefined {
    return this.invoices[this.invoices.length - 1];
  }

  /** e.g. ['trialing', 'past_due', 'active'] */
  statusHistory(): SubscriptionStatus[] {
    const history: SubscriptionStatus[] = [];
    for (const e of this.audit) {
      if ((e.action === 'created' || e.action === 'status_changed') && e.toStatus) history.push(e.toStatus);
    }
    return history;
  }

  auditActions(): string[] {
    return this.audit.map((e) => e.action);
  }

  attemptsFor(invoiceId: string): ChargeAttempt[] {
    return this.attempts.filter((a) => a.invoiceId === invoiceId);
  }

  notificationKinds(): string[] {
    return this.notifications.map((n) => n.kind);
  }

  /** The API view must be derivable from what's stored - field by field. */
  mismatchesWith(api: SubscriptionBody): string[] {
    const stored = this.subscription;
    const latestInvoice = this.latestInvoice;
    const expected: Record<string, unknown> = {
      id: stored.id,
      customer_id: stored.customerId,
      plan: stored.plan,
      status: stored.status,
      payment_method_id: stored.paymentMethodId,
      amount: stored.priceCents,
      currency: stored.currency,
      trial_ends_at: stored.trialEndsAt,
      current_period_start: stored.currentPeriodStart,
      current_period_end: stored.currentPeriodEnd,
      canceled_at: stored.canceledAt,
      cancel_reason: stored.cancelReason,
      created_at: stored.createdAt,
      latest_invoice: latestInvoice
        ? { id: latestInvoice.id, status: latestInvoice.status, amount: latestInvoice.amountCents, failed_attempts: latestInvoice.failedAttempts }
        : null,
    };
    const apiFields = api as Record<string, unknown>;
    return Object.entries(expected)
      .filter(([field, storedValue]) => JSON.stringify(storedValue) !== JSON.stringify(apiFields[field]))
      .map(([field, storedValue]) => `${field}: api=${JSON.stringify(apiFields[field])} db=${JSON.stringify(storedValue)}`);
  }
}
