import type { AuditEntry } from '../../../src/domain/AuditEntry';
import type { InvoiceRecord, InvoiceStatus } from '../../../src/domain/Invoice';
import type { SubscriptionStatus } from '../../../src/domain/Subscription';
import type { WebhookEventRecord } from '../../../src/domain/WebhookEvent';
import type { AuditLogRepository } from '../../../src/persistence/AuditLogRepository';
import type { InvoiceRepository } from '../../../src/persistence/InvoiceRepository';
import type { SubscriptionRepository } from '../../../src/persistence/SubscriptionRepository';
import type { WebhookEventRepository } from '../../../src/persistence/WebhookEventRepository';

export interface Repositories {
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
  auditLog: AuditLogRepository;
}

/** A full copy of every store, for "nothing changed" comparisons. */
export type StoreSnapshot = Awaited<ReturnType<PersistenceAssertions['snapshot']>>;

/** The comparable part of an audit entry (timestamps are checked separately). */
export interface ExpectedAuditEntry {
  from: SubscriptionStatus;
  to: SubscriptionStatus;
  trigger: AuditEntry['trigger'];
  source: AuditEntry['source'];
  eventId?: string;
}

/**
 * Hard-coded on purpose (not imported from src): the retry limit is a business rule that this
 * oracle should state independently of the implementation.
 */
const MAX_CONSECUTIVE_FAILED_INVOICES = 3;

/** Persistence assertions go through the repositories, never through raw data structures. */
export class PersistenceAssertions {
  constructor(private readonly repos: Repositories) {}

  // ---- subscriptions ----

  async expectNoSubscriptions(): Promise<void> {
    expect(await this.repos.subscriptions.list()).toHaveLength(0);
  }

  async expectSubscriptionCount(count: number): Promise<void> {
    expect(await this.repos.subscriptions.list()).toHaveLength(count);
  }

  async expectStoredStatus(id: string, status: SubscriptionStatus): Promise<void> {
    expect((await this.repos.subscriptions.findById(id))?.status).toBe(status);
  }

  /** The payment method is stored so later billing can charge it; it is never exposed by the API. */
  async expectStoredPaymentMethod(id: string, paymentMethodId: string): Promise<void> {
    expect(await this.repos.subscriptions.findById(id)).toMatchObject({ paymentMethodId });
  }

  /** The stored row must agree with what the API returned for the same subscription. */
  async expectSubscriptionMatchesApi(apiBody: Record<string, any>): Promise<void> {
    const stored = await this.repos.subscriptions.findById(apiBody.id);
    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      id: apiBody.id,
      customerId: apiBody.customer_id,
      plan: apiBody.plan,
      status: apiBody.status,
      priceCents: apiBody.price,
      currency: apiBody.currency,
      trialEndsAt: apiBody.trial_ends_at,
      createdAt: apiBody.created_at,
    });
  }

  // ---- invoices ----

  async expectNoInvoices(): Promise<void> {
    expect(await this.repos.invoices.list()).toHaveLength(0);
  }

  async expectInvoiceCount(subscriptionId: string, count: number): Promise<void> {
    expect(await this.repos.invoices.listBySubscription(subscriptionId)).toHaveLength(count);
  }

  /** Statuses of a subscription's invoices in attempt order, e.g. `['failed', 'failed', 'pending']`. */
  async expectInvoiceStatuses(subscriptionId: string, statuses: InvoiceStatus[]): Promise<void> {
    const invoices = await this.repos.invoices.listBySubscription(subscriptionId);
    expect(invoices.map((invoice) => invoice.status)).toEqual(statuses);
  }

  async expectInvoice(id: string, expected: Partial<InvoiceRecord>): Promise<void> {
    const invoice = await this.repos.invoices.findById(id);
    expect(invoice).toBeDefined();
    expect(invoice).toMatchObject(expected);
  }

  /** A declined / unresolved invoice must not look like a captured payment. */
  async expectInvoiceWithoutProviderCharge(id: string): Promise<void> {
    const invoice = await this.repos.invoices.findById(id);
    expect(invoice).toBeDefined();
    expect(invoice).not.toHaveProperty('providerChargeId');
  }

  /**
   * The invoices' idempotency keys, in attempt order, are exactly `keys`. Compared with the keys the
   * provider received, this proves "one charge per recorded billing attempt, and no unrecorded charge".
   */
  async expectInvoiceKeys(subscriptionId: string, keys: string[]): Promise<void> {
    const invoices = await this.repos.invoices.listBySubscription(subscriptionId);
    expect(invoices.map((invoice) => invoice.idempotencyKey)).toEqual(keys);
  }

  // ---- webhook events ----

  async expectNoWebhookEvents(): Promise<void> {
    expect(await this.repos.webhookEvents.list()).toHaveLength(0);
  }

  async expectWebhookEventCount(count: number): Promise<void> {
    expect(await this.repos.webhookEvents.list()).toHaveLength(count);
  }

  async expectWebhookEvent(eventId: string, expected: Partial<WebhookEventRecord>): Promise<void> {
    const event = await this.repos.webhookEvents.findByEventId(eventId);
    expect(event).toBeDefined();
    expect(event).toMatchObject(expected);
  }

  // ---- audit log ----

  async expectNoAuditEntries(subscriptionId?: string): Promise<void> {
    const entries =
      subscriptionId === undefined
        ? await this.repos.auditLog.list()
        : await this.repos.auditLog.listBySubscription(subscriptionId);
    expect(entries).toHaveLength(0);
  }

  async expectAuditTrail(subscriptionId: string, expected: ExpectedAuditEntry[]): Promise<void> {
    const entries = await this.repos.auditLog.listBySubscription(subscriptionId);
    expect(entries.map(({ from, to, trigger, source, eventId }) => ({ from, to, trigger, source, eventId }))).toEqual(
      expected,
    );
  }

  /** The statuses the subscription went through, whoever caused each step (e.g. `['trialing', 'active', 'canceled']`). */
  async expectAuditPath(subscriptionId: string, statuses: SubscriptionStatus[]): Promise<void> {
    const entries = await this.repos.auditLog.listBySubscription(subscriptionId);
    const path = entries.length === 0 ? [] : [entries[0].from, ...entries.map((entry) => entry.to)];
    expect(path).toEqual(statuses);
  }

  /** The n-th audit entry (0-based) was written at exactly this instant (the fake clock's time). */
  async expectAuditEntryAt(subscriptionId: string, index: number, iso: string): Promise<void> {
    const entries = await this.repos.auditLog.listBySubscription(subscriptionId);
    expect(entries[index]?.at).toBe(iso);
  }

  // ---- whole-store comparisons ----

  async snapshot() {
    return {
      subscriptions: await this.repos.subscriptions.list(),
      invoices: await this.repos.invoices.list(),
      webhookEvents: await this.repos.webhookEvents.list(),
      auditLog: await this.repos.auditLog.list(),
    };
  }

  /** Every store is exactly as it was when the snapshot was taken (rejected requests leave no trace). */
  async expectUnchangedSince(before: StoreSnapshot): Promise<void> {
    expect(await this.snapshot()).toEqual(before);
  }

  // ---- cross-entity invariants ----

  /**
   * Checks that subscription, invoices, webhook events and audit log do not contradict each other
   * (and, when given, the API-visible result). Run after every step of a lifecycle spec.
   */
  async expectCoherent(subscriptionId: string, apiBody?: Record<string, any>): Promise<void> {
    const subscription = await this.repos.subscriptions.findById(subscriptionId);
    expect(subscription).toBeDefined();
    const sub = subscription!;
    const invoices = await this.repos.invoices.listBySubscription(subscriptionId);
    const audit = await this.repos.auditLog.listBySubscription(subscriptionId);

    // 1. Persisted state equals the API-visible state.
    if (apiBody) {
      expect(sub.status).toBe(apiBody.status);
    }

    // 2. active needs at least one successful payment on record (a refunded invoice was paid once).
    if (sub.status === 'active') {
      expect(invoices.some((i) => i.status === 'paid' || i.status === 'refunded')).toBe(true);
    }

    // 3. past_due needs a recorded failure; failures never run past the retry limit.
    if (sub.status === 'past_due') {
      expect(invoices.some((i) => i.status === 'failed')).toBe(true);
    }
    expect(this.trailingFailedInvoices(invoices)).toBeLessThanOrEqual(MAX_CONSECUTIVE_FAILED_INVOICES);

    // 4. Money matches the plan the subscription is on.
    for (const invoice of invoices) {
      expect({ amount: invoice.amount, currency: invoice.currency }).toEqual({
        amount: sub.priceCents,
        currency: sub.currency,
      });
    }

    // 5. One invoice per billing attempt: attempts and idempotency keys are unique.
    expect(new Set(invoices.map((i) => i.idempotencyKey)).size).toBe(invoices.length);
    expect(new Set(invoices.map((i) => i.attempt)).size).toBe(invoices.length);

    // 6. The audit chain is contiguous, ends at the current status, and nothing follows `canceled`.
    for (let i = 1; i < audit.length; i += 1) {
      expect(audit[i].from).toBe(audit[i - 1].to);
    }
    if (audit.length > 0) {
      expect(audit[audit.length - 1].to).toBe(sub.status);
    }
    const canceledAt = audit.findIndex((entry) => entry.to === 'canceled');
    if (canceledAt !== -1) {
      expect(audit).toHaveLength(canceledAt + 1);
    }

    // 7. Every webhook-caused transition points at a stored, processed event.
    for (const entry of audit.filter((e) => e.source === 'webhook')) {
      const event = await this.repos.webhookEvents.findByEventId(entry.eventId ?? '');
      expect(event).toMatchObject({ outcome: 'processed', subscriptionId });
    }

    // 8. An unanswered charge is a single, latest `pending` invoice (a second one would be a double charge).
    const pending = invoices.filter((i) => i.status === 'pending');
    expect(pending.length).toBeLessThanOrEqual(1);
    if (pending.length === 1) {
      expect(invoices[invoices.length - 1].id).toBe(pending[0].id);
    }

    // 9. Time only moves forward: nothing predates the subscription, invoices are not updated before
    //    they were created, and the audit log is in chronological order.
    const created = Date.parse(sub.createdAt);
    for (const invoice of invoices) {
      expect(Date.parse(invoice.createdAt)).toBeGreaterThanOrEqual(created);
      expect(Date.parse(invoice.updatedAt)).toBeGreaterThanOrEqual(Date.parse(invoice.createdAt));
    }
    for (let i = 0; i < audit.length; i += 1) {
      expect(Date.parse(audit[i].at)).toBeGreaterThanOrEqual(i === 0 ? created : Date.parse(audit[i - 1].at));
    }
  }

  private trailingFailedInvoices(invoices: InvoiceRecord[]): number {
    let count = 0;
    for (let i = invoices.length - 1; i >= 0 && invoices[i].status === 'failed'; i -= 1) {
      count += 1;
    }
    return count;
  }
}
