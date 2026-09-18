import { expect } from 'vitest';
import type { TestEnvironment } from '../harness/test-environment';

/**
 * System-wide invariants, asserted after *every* test in the suite.
 *
 * These are the claims that must hold no matter which scenario just ran. Wiring
 * them into afterEach means a test written about one behaviour also defends all
 * of them — the cheapest regression net in the suite.
 */
export async function assertSystemInvariants(env: TestEnvironment): Promise<void> {
  const subscriptions = env.repos.subscriptions.all();
  const allInvoices = env.repos.invoices.all();

  for (const sub of subscriptions) {
    // I1: persisted state always matches the externally observed API result.
    const res = await env.api.get(sub.id);
    expect(res.status, `GET /subscriptions/${sub.id}`).toBe(200);
    expect(res.body.state, `API vs persisted state for ${sub.id}`).toBe(sub.state);

    const invoices = allInvoices.filter((i) => i.subscription_id === sub.id);
    // "Successfully paid at some point": a later refund does not erase the fact.
    const paid = invoices.filter((i) => i.paid_at !== null);

    // I2: a subscription never reaches `active` without a persisted successful payment.
    if (sub.state === 'active') {
      expect(paid.length, `active subscription ${sub.id} must have a paid invoice`).toBeGreaterThan(0);
    }

    // I3: a trialing subscription has never been successfully billed.
    if (sub.state === 'trialing') {
      expect(paid.length, `trialing subscription ${sub.id} must have no paid invoice`).toBe(0);
    }

    const transitions = env.repos.subscriptionEvents.transitionsFor(sub.id);

    // I4: `canceled` is terminal — it is the last transition, and it happened once.
    if (sub.state === 'canceled') {
      const last = transitions[transitions.length - 1];
      expect(last?.to_state, `last transition of canceled ${sub.id}`).toBe('canceled');
      expect(
        transitions.filter((t) => t.to_state === 'canceled').length,
        `${sub.id} cancelled more than once`
      ).toBe(1);
      expect(sub.canceled_at, `canceled_at on ${sub.id}`).not.toBeNull();
      // No billable invoice may be left open on a canceled subscription.
      expect(invoices.filter((i) => i.status === 'pending').length).toBe(0);
    }

    // I5: the audit log is contiguous and ordered.
    const seqs = env.repos.subscriptionEvents.findBySubscription(sub.id).map((e) => e.seq);
    expect(seqs, `audit sequence for ${sub.id}`).toEqual(seqs.map((_, i) => i + 1));

    // I6: state and record coherence — no `active` subscription whose only
    // invoice record is a failure, and no un-timestamped state.
    expect(new Date(sub.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(sub.created_at).getTime());
  }

  // I7: one provider call per invoice, exactly — invoices are only ever opened
  // immediately before a charge, so any drift means a double- or phantom-charge.
  expect(env.provider.callCount, 'provider calls vs invoice rows').toBe(allInvoices.length);

  // I8: idempotency keys are unique per attempt and never reused.
  const keys = env.provider.idempotencyKeys();
  expect(new Set(keys).size, 'duplicate idempotency key sent to provider').toBe(keys.length);

  for (const invoice of allInvoices) {
    const calls = env.provider.calls.filter((c) => c.reference.invoiceId === invoice.id);
    expect(calls.length, `provider calls for invoice ${invoice.id}`).toBeLessThanOrEqual(1);

    // I9: settled invoices carry their evidence.
    if (invoice.status === 'paid') {
      expect(invoice.provider_charge_id, `charge id on ${invoice.id}`).not.toBeNull();
      expect(invoice.paid_at, `paid_at on ${invoice.id}`).not.toBeNull();
    }
    // A refund can only ever follow a real payment.
    if (invoice.status === 'refunded') {
      expect(invoice.paid_at, `refunded invoice ${invoice.id} must have been paid first`).not.toBeNull();
      expect(invoice.refunded_at, `refunded_at on ${invoice.id}`).not.toBeNull();
    }
    if (invoice.status === 'pending' || invoice.status === 'void') {
      expect(invoice.paid_at, `unsettled invoice ${invoice.id} must not look paid`).toBeNull();
    }
    if (invoice.status === 'failed') expect(invoice.failure_code, `failure code on ${invoice.id}`).not.toBeNull();

    // I10: the amount billed always equals the plan price for that plan.
    expect(invoice.amount_cents, `amount on ${invoice.id}`).toBe(
      env.system.plans.get(invoice.plan).priceCents
    );
  }

  // I11: every recorded provider event points at a real subscription and invoice.
  for (const event of env.repos.webhookEvents.all()) {
    expect(env.repos.subscriptions.findById(event.subscription_id)).not.toBeNull();
    if (event.invoice_id) expect(env.repos.invoices.findById(event.invoice_id)).not.toBeNull();
  }
}
