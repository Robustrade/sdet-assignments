import { expect } from 'vitest';
import type { SubscriptionStatus } from '../../../src/domain/types';
import type { TestEnvironment } from '../fixtures/TestEnvironment';

/**
 * Assertions about persisted state, expressed as business invariants rather than
 * raw row inspection in the test body. Reads go through the repositories (the
 * same seam the service writes through), and the API-vs-DB check proves the
 * externally-observed result matches what is stored.
 */
export class PersistenceVerifier {
  constructor(private readonly env: TestEnvironment) {}

  subscriptionStatus(id: string, expected: SubscriptionStatus): this {
    const sub = this.env.db.subscriptions.findById(id);
    expect(sub, `subscription ${id} should exist`).toBeDefined();
    expect(sub!.status, 'persisted subscription status').toBe(expected);
    return this;
  }

  failedChargeCount(id: string, expected: number): this {
    const sub = this.env.db.subscriptions.findById(id);
    expect(sub!.failedChargeCount, 'persisted failed charge count').toBe(expected);
    return this;
  }

  invoiceCount(subscriptionId: string, expected: number): this {
    const n = this.env.db.invoices.findBySubscription(subscriptionId).length;
    expect(n, 'invoice row count').toBe(expected);
    return this;
  }

  paidInvoiceCount(subscriptionId: string, expected: number): this {
    const n = this.env.db.invoices.findBySubscription(subscriptionId).filter(
      (i) => i.status === 'paid',
    ).length;
    expect(n, 'paid invoice count').toBe(expected);
    return this;
  }

  invoiceStatus(invoiceId: string, expected: string): this {
    const invoice = this.env.db.invoices.findById(invoiceId);
    expect(invoice, `invoice ${invoiceId} should exist`).toBeDefined();
    expect(invoice!.status, 'invoice status').toBe(expected);
    return this;
  }

  webhookEventRecorded(eventId: string): this {
    expect(this.env.db.webhookEvents.has(eventId), `webhook event ${eventId} recorded`).toBe(true);
    return this;
  }

  webhookEventCount(expected: number): this {
    expect(this.env.db.webhookEvents.count(), 'webhook_events row count').toBe(expected);
    return this;
  }

  auditEventCount(subscriptionId: string, expected: number): this {
    const n = this.env.db.eventLog.findBySubscription(subscriptionId).length;
    expect(n, 'audit event count').toBe(expected);
    return this;
  }

  auditContainsType(subscriptionId: string, type: string): this {
    const types = this.env.db.eventLog.findBySubscription(subscriptionId).map((e) => e.type);
    expect(types, `audit log should contain ${type}`).toContain(type);
    return this;
  }

  /** The externally-observed API status must equal the persisted status. */
  async apiAndDbAgree(id: string): Promise<this> {
    const res = await this.env.api.getSubscription(id);
    expect(res.status, 'GET subscription status code').toBe(200);
    const persisted = this.env.db.subscriptions.findById(id);
    expect(res.body.status, 'API status vs persisted status').toBe(persisted!.status);
    return this;
  }

  /**
   * Core cross-entity invariant: an `active` subscription must have at least one
   * paid invoice, and a subscription that is not active/past_due must not be
   * `active` without payment evidence. Guards against contradictory records.
   */
  noContradictoryRecords(id: string): this {
    const sub = this.env.db.subscriptions.findById(id);
    expect(sub, `subscription ${id} should exist`).toBeDefined();
    const invoices = this.env.db.invoices.findBySubscription(id);
    if (sub!.status === 'active') {
      const paid = invoices.filter((i) => i.status === 'paid').length;
      expect(paid, 'active subscription must have >=1 paid invoice').toBeGreaterThanOrEqual(1);
    }
    // No subscription may reference invoices that belong to another subscription.
    for (const invoice of invoices) {
      expect(invoice.subscriptionId, 'invoice must belong to its subscription').toBe(id);
    }
    return this;
  }
}
