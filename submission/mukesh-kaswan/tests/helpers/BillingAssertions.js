const { expect } = require('@playwright/test');

/**
 * Verification layer: API responses, persisted state (via the repository)
 * and payment-provider interactions, expressed as business checks.
 */
class BillingAssertions {
  constructor({ api, db, provider }) {
    this.api = api;
    this.db = db;
    this.provider = provider;
  }

  /** Checks the status through the API AND that the stored row equals the API response. */
  async subscriptionIs(id, expectedStatus) {
    const res = await this.api.getSubscription(id);
    expect(res.status()).toBe(200);
    const fromApi = await res.json();

    expect(fromApi.status, 'status returned by the API').toBe(expectedStatus);
    expect(this.db.findSubscription(id), 'stored subscription must match the API response').toEqual(fromApi);
    return fromApi;
  }

  invoiceStatuses(subscriptionId, expectedStatuses) {
    const statuses = this.db.invoicesFor(subscriptionId).map((i) => i.status);
    expect(statuses, 'invoice statuses in the store').toEqual(expectedStatuses);
  }

  auditTrail(subscriptionId, expectedStates) {
    const states = this.db.auditFor(subscriptionId).map((e) => e.to);
    expect(states, 'audit log (sequence of states)').toEqual(expectedStates);
  }

  webhookRecorded(eventId, expected) {
    expect(this.db.findWebhookEvent(eventId), `webhook_events row for ${eventId}`).toMatchObject(expected);
  }

  providerNotCalled() {
    expect(this.provider.calls, 'payment provider calls').toHaveLength(0);
  }

  providerCalledOnceWith(expectedRequest) {
    expect(this.provider.calls, 'payment provider calls').toHaveLength(1);
    expect(this.provider.calls[0]).toEqual(expectedRequest);
  }

  noSubscriptionsStored() {
    expect(this.db.allSubscriptions(), 'stored subscriptions').toHaveLength(0);
  }
}

/**
 * Invariants that must hold at the end of EVERY test. Runs automatically
 * from the fixture teardown, so no test can leave contradictory data behind.
 */
function assertGlobalInvariants({ db, provider }) {
  for (const sub of db.allSubscriptions()) {
    const invoices = db.invoicesFor(sub.id);
    const audit = db.auditFor(sub.id);

    if (sub.status === 'active') {
      const hasSuccessfulPayment = invoices.some((i) => i.status === 'paid' || i.status === 'refunded');
      expect(hasSuccessfulPayment, `${sub.id} is active without a successful payment`).toBe(true);
    }
    expect(audit.at(-1)?.to, `${sub.id} status must equal its last audit entry`).toBe(sub.status);
    expect(sub.canceled_at !== null, `${sub.id} canceled_at must be set only when canceled`).toBe(sub.status === 'canceled');
    expect(sub.updated_at >= sub.created_at, `${sub.id} updated_at before created_at`).toBe(true);
  }

  for (const invoice of db.allInvoices()) {
    const sub = db.findSubscription(invoice.subscription_id);
    expect(sub, `${invoice.id} has no subscription`).not.toBeNull();
    if (invoice.status === 'paid' || invoice.status === 'refunded') {
      expect(invoice.amount, `${invoice.id} was paid at a different price than the plan`).toBe(sub.price);
    }
  }

  const keys = provider.calls.map((c) => c.idempotency_key);
  expect(new Set(keys).size, 'provider was charged twice for the same invoice').toBe(keys.length);
}

module.exports = { BillingAssertions, assertGlobalInvariants };
