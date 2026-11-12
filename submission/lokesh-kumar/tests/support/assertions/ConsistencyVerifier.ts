import { expect } from 'vitest';
import type { SubscriptionState } from '../../../src/domain/types.js';
import type { SubscriptionApiClient } from '../clients/ApiClient.js';
import type {
  AuditReadRepository,
  InvoiceReadRepository,
  SubscriptionReadRepository,
} from '../repositories/ReadRepositories.js';

/** The lifecycle diagram written out independently of the service, as the test oracle. */
const LEGAL_TRANSITIONS: ReadonlyArray<readonly [SubscriptionState, SubscriptionState]> = [
  ['trialing', 'active'],
  ['trialing', 'past_due'],
  ['active', 'past_due'],
  ['past_due', 'active'],
  ['past_due', 'canceled'],
  ['active', 'canceled'],
  ['trialing', 'canceled'],
];

export interface VerifierDeps {
  api: SubscriptionApiClient;
  subscriptions: SubscriptionReadRepository;
  invoices: InvoiceReadRepository;
  audit: AuditReadRepository;
}

/**
 * Cross-checks the API view, the persisted rows and the business invariants for one
 * subscription. Call it after every step of a scenario, not only at creation.
 */
export class ConsistencyVerifier {
  private readonly deps: VerifierDeps;

  constructor(deps: VerifierDeps) {
    this.deps = deps;
  }

  async assertConsistent(subscriptionId: string): Promise<void> {
    const { api, subscriptions, invoices, audit } = this.deps;

    // 1. Persisted state matches what the API shows.
    const response = await api.getSubscription(subscriptionId);
    const row = subscriptions.get(subscriptionId);
    expect(response.status).toBe(200);
    expect(row).toBeDefined();
    expect(response.body.status).toBe(row!.status);
    expect(response.body.plan).toBe(row!.plan);
    expect(response.body.customer_id).toBe(row!.customerId);

    const rows = invoices.forSubscription(subscriptionId);

    // 2. A subscription never reaches active without a successful, persisted payment.
    if (row!.status === 'active') {
      expect(rows.some((i) => i.paidAt !== null)).toBe(true);
    }

    // 3. No duplicate invoices or duplicate provider references.
    expect(new Set(rows.map((i) => i.id)).size).toBe(rows.length);
    expect(new Set(rows.map((i) => i.idempotencyKey)).size).toBe(rows.length);

    // 4. Each invoice is internally coherent.
    for (const invoice of rows) {
      if (invoice.status === 'paid' || invoice.status === 'refunded') {
        expect(invoice.paidAt).not.toBeNull();
        expect(invoice.failureReason).toBeNull();
      }
      if (invoice.status === 'failed') {
        expect(invoice.paidAt).toBeNull();
        expect(invoice.failureReason).not.toBeNull();
      }
      if (invoice.status === 'pending') {
        expect(invoice.paidAt).toBeNull();
      }
      expect(invoice.subscriptionId).toBe(subscriptionId);
    }

    // 5. The audit log is a legal, unbroken chain that ends at the current status.
    const log = audit.forSubscription(subscriptionId);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].from).toBeNull();
    expect(log[0].to).toBe('trialing');
    for (let i = 1; i < log.length; i++) {
      expect(log[i].from).toBe(log[i - 1].to);
      expect(LEGAL_TRANSITIONS.some(([from, to]) => from === log[i].from && to === log[i].to)).toBe(true);
      expect(Date.parse(log[i].at)).toBeGreaterThanOrEqual(Date.parse(log[i - 1].at));
    }
    expect(log[log.length - 1].to).toBe(row!.status);

    // 6. canceled is terminal: nothing follows it.
    const canceledAt = log.findIndex((e) => e.to === 'canceled');
    if (canceledAt !== -1) expect(canceledAt).toBe(log.length - 1);

    // 7. Timestamps are coherent.
    expect(Date.parse(row!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(row!.createdAt));
  }
}
