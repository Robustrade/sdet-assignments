import { expect } from 'vitest';
import type { AuditEntry, Invoice, Subscription, WebhookEventRecord } from '../../../src/domain/types';
import type { SubscriptionDto } from '../../../src/http/subscriptionDto';
import type { Repositories } from '../../../src/persistence/repositories';

export interface TransitionView {
  readonly from: AuditEntry['fromStatus'];
  readonly to: AuditEntry['toStatus'];
  readonly trigger: string;
  readonly source: AuditEntry['source'];
}

/** Everything stored for one subscription. Compare two snapshots to prove a request changed nothing. */
export interface SubscriptionSnapshot {
  readonly subscription: Subscription | undefined;
  readonly invoices: readonly Invoice[];
  readonly audit: readonly AuditEntry[];
}

/** Reads the database through the repositories (no raw SQL in specs) and checks stored state. */
export class DbVerifier {
  constructor(private readonly repos: Repositories) {}

  subscription(id: string): Subscription {
    const subscription = this.repos.subscriptions.findById(id);
    expect(subscription, `subscription ${id} should be stored`).toBeDefined();
    return subscription as Subscription;
  }

  allSubscriptions(): Subscription[] {
    return this.repos.subscriptions.findAll();
  }

  /** Oldest first. */
  invoices(subscriptionId: string): Invoice[] {
    return this.repos.invoices.findBySubscription(subscriptionId);
  }

  invoiceStatuses(subscriptionId: string): string[] {
    return this.invoices(subscriptionId).map((invoice) => invoice.status);
  }

  onlyInvoice(subscriptionId: string): Invoice {
    const invoices = this.invoices(subscriptionId);
    expect(invoices, `subscription ${subscriptionId} should have exactly one invoice`).toHaveLength(1);
    return invoices[0] as Invoice;
  }

  latestInvoice(subscriptionId: string): Invoice {
    const invoices = this.invoices(subscriptionId);
    expect(invoices.length, `subscription ${subscriptionId} should have an invoice`).toBeGreaterThan(0);
    return invoices[invoices.length - 1] as Invoice;
  }

  pendingInvoice(subscriptionId: string): Invoice {
    const invoice = this.repos.invoices.findPendingBySubscription(subscriptionId);
    expect(invoice, `subscription ${subscriptionId} should have a pending invoice`).toBeDefined();
    return invoice as Invoice;
  }

  invoice(id: string): Invoice {
    const invoice = this.repos.invoices.findById(id);
    expect(invoice, `invoice ${id} should be stored`).toBeDefined();
    return invoice as Invoice;
  }

  auditTrail(subscriptionId: string): AuditEntry[] {
    return this.repos.audit.findBySubscription(subscriptionId);
  }

  /** Status changes only, oldest first. */
  transitions(subscriptionId: string): TransitionView[] {
    return this.auditTrail(subscriptionId)
      .filter((entry) => entry.kind === 'transition')
      .map((entry) => ({ from: entry.fromStatus, to: entry.toStatus, trigger: entry.trigger, source: entry.source }));
  }

  lastTransition(subscriptionId: string): TransitionView | undefined {
    const transitions = this.transitions(subscriptionId);
    return transitions[transitions.length - 1];
  }

  /** Names of non-status events (renewal_succeeded, retry_failed, payment_refunded), oldest first. */
  events(subscriptionId: string): string[] {
    return this.auditTrail(subscriptionId)
      .filter((entry) => entry.kind === 'event')
      .map((entry) => entry.trigger);
  }

  webhookEvent(eventId: string): WebhookEventRecord | undefined {
    return this.repos.webhookEvents.findById(eventId);
  }

  webhookEvents(): WebhookEventRecord[] {
    return this.repos.webhookEvents.findAll();
  }

  snapshot(subscriptionId: string): SubscriptionSnapshot {
    return {
      subscription: this.repos.subscriptions.findById(subscriptionId),
      invoices: this.invoices(subscriptionId),
      audit: this.auditTrail(subscriptionId),
    };
  }

  /** The API response and the stored row must say the same thing, field by field. */
  expectMatchesApi(dto: SubscriptionDto): void {
    const row = this.subscription(dto.id);
    expect(dto).toEqual({
      id: row.id,
      customer_id: row.customerId,
      payment_method_id: row.paymentMethodId,
      plan: row.plan,
      status: row.status,
      trial_ends_at: row.trialEndsAt,
      current_period_end: row.currentPeriodEnd,
      canceled_at: row.canceledAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    });
  }

  /** For rejected requests: no subscription, invoice, audit entry or webhook event was saved. */
  expectNothingStored(): void {
    expect(this.repos.subscriptions.findAll()).toEqual([]);
    expect(this.repos.invoices.findAll()).toEqual([]);
    expect(this.repos.audit.findAll()).toEqual([]);
    expect(this.repos.webhookEvents.findAll()).toEqual([]);
  }
}
