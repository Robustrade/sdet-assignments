import { describe, expect, it } from 'vitest';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';

/**
 * LEVEL 3 — persistence and auditability.
 *
 * Every read goes through a repository, never a raw store lookup, and each test
 * checks that the persisted record agrees with the API-visible outcome *and*
 * with the business rules for that stage of the lifecycle.
 */
describe('Persistence and audit trail', () => {
  const suite = useBillingSystem();

  it('starts each test with an empty store and cloned reads, so no assertion can pass on stale or mutated data', async () => {
    expect(suite.env.repos.subscriptions.all()).toHaveLength(0);
    expect(suite.env.repos.invoices.all()).toHaveLength(0);
    expect(suite.env.repos.webhookEvents.all()).toHaveLength(0);
    expect(suite.env.repos.subscriptionEvents.all()).toHaveLength(0);
    expect(suite.env.repos.customers.all(), 'seeded reference data only').toHaveLength(2);

    const sub = await suite.env.scenarios.trialing();
    const record = suite.env.repos.subscriptions.requireById(sub.id);
    record.state = 'active';
    record.plan = 'tampered';

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('trialing');
    expect(suite.env.repos.subscriptions.requireById(sub.id).plan).toBe('pro');
  });

  it('keeps the subscription row in step with the API at every stage of the lifecycle', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'basic' });
    const row = () => suite.env.repos.subscriptions.requireById(sub.id);

    expect(row()).toMatchObject({
      plan: 'basic',
      state: 'trialing',
      trial_ends_at: '2026-01-08T00:00:00.000Z',
      current_period_end: null,
      canceled_at: null,
      retries_remaining: 2
    });

    suite.env.advanceDays(7);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');
    expect(row().current_period_end, '+30 days').toBe('2026-02-07T00:00:00.000Z');
    expect(row().next_retry_at).toBeNull();

    suite.env.advanceDays(30);
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    expect(row().retries_remaining).toBe(2);
    expect(row().next_retry_at, '+3 days').toBe('2026-02-10T00:00:00.000Z');

    suite.env.advanceDays(3);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');
    expect(row().next_retry_at).toBeNull();

    expect((await suite.env.api.cancel(sub.id)).status).toBe(200);
    expect(row().canceled_at).toBe('2026-02-10T00:00:00.000Z');
    await SubscriptionAssertions.for(suite.env, sub.id).apiAndPersistenceAgree();
  });

  it('writes one invoice row per billing attempt, with coherent amounts and timestamps', async () => {
    const sub = await suite.env.scenarios.pastDue({ plan: 'basic' });
    suite.env.advanceDays(3);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();

    const invoices = suite.env.repos.invoices.findBySubscription(sub.id);
    expect(invoices).toHaveLength(2);
    expect(invoices.map((i) => i.attempt)).toEqual([1, 2]);
    expect(invoices.map((i) => i.status)).toEqual(['failed', 'paid']);
    expect(invoices.every((i) => i.amount_cents === 1900 && i.currency === 'USD')).toBe(true);
    expect(invoices.every((i) => i.subscription_id === sub.id && i.customer_id === 'cust_001')).toBe(true);

    const [failed, paid] = invoices;
    expect(failed.failure_code).toBe('card_declined');
    expect(failed.paid_at).toBeNull();
    expect(paid.provider_charge_id).not.toBeNull();
    expect(new Date(paid.paid_at!).getTime()).toBeGreaterThanOrEqual(new Date(paid.created_at).getTime());
    expect(new Date(paid.created_at).getTime()).toBeGreaterThan(new Date(failed.created_at).getTime());
  });

  it('records processed, ignored and redelivered provider events', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult({ plan: 'pro' });
    const invoice = await suite.env.latestInvoice(sub.id);
    const accepted = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();
    const forged = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).withAmount(1).build();

    await suite.env.webhooks.deliver(accepted);
    await suite.env.webhooks.deliver(accepted); // redelivery
    await suite.env.webhooks.deliver(forged);

    expect(suite.env.repos.webhookEvents.findBySubscription(sub.id)).toHaveLength(2);
    expect(suite.env.repos.webhookEvents.findById(accepted.event_id)).toMatchObject({
      outcome: 'processed',
      reason: null,
      state_before: 'trialing',
      state_after: 'active',
      delivery_count: 2,
      invoice_id: invoice.id
    });
    expect(suite.env.repos.webhookEvents.findById(forged.event_id)).toMatchObject({
      outcome: 'ignored',
      reason: 'AMOUNT_MISMATCH',
      state_before: 'active',
      state_after: 'active',
      delivery_count: 1
    });
  });

  it('keeps a per-subscription audit log that explains how the state was reached', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult({ plan: 'pro' });
    const invoice = await suite.env.latestInvoice(sub.id);
    const event = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();
    await suite.env.webhooks.deliver(event);

    const log = suite.env.repos.subscriptionEvents.findBySubscription(sub.id);

    expect(log.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log[0]).toMatchObject({ kind: 'note', note: 'trial_started', source: 'api' });
    expect(log[1]).toMatchObject({
      kind: 'note',
      note: 'charge_attempt_timed_out',
      source: 'billing_runner',
      invoice_id: invoice.id
    });
    expect(log[2]).toMatchObject({
      kind: 'transition',
      transition_id: 'TRIAL_ENDS_CHARGE_SUCCEEDED',
      trigger: 'trial_charge_succeeded',
      from_state: 'trialing',
      to_state: 'active',
      source: 'webhook',
      invoice_id: invoice.id,
      event_id: event.event_id
    });

    // The same trail is auditable through the API, not only the store.
    const api = await suite.env.api.listEvents(sub.id);
    expect(api.status).toBe(200);
    expect(api.body.data).toHaveLength(3);
  });
});
