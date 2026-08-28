const { test, expect } = require('@playwright/test');
const {
  BillingAssertions,
  SubscriptionApiClient,
  SubscriptionBuilder,
  WebhookBuilder
} = require('../support/testFramework');

test.describe('Subscription and Billing Service', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new SubscriptionApiClient(request);
    await expect((await api.reset()).status()).toBe(200);
  });

  test('creates a trial subscription and charges it with the expected provider arguments', async () => {
    const response = await api.create(new SubscriptionBuilder().build());
    expect(response.status()).toBe(201);
    const subscription = await response.json();
    expect(subscription).toMatchObject({ status: 'trialing', plan: 'pro', price: 4900, trial_days: 7 });

    await expect((await api.charge(subscription.id)).status()).toBe(200);
    const state = await BillingAssertions.stateMatches(await api.state(subscription.id), 'active', 1);
    expect(state.provider_calls).toHaveLength(1);
    expect(state.provider_calls[0]).toMatchObject({ customer_id: 'cust_001', amount: 4900, currency: 'USD' });
  });

  test('covers payment failure, retry success, and exhausted retries', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    await api.configureProvider('decline');
    await expect((await api.charge(subscription.id)).status()).toBe(200);
    await BillingAssertions.stateMatches(await api.state(subscription.id), 'past_due', 1);

    await api.configureProvider('success');
    await expect((await api.charge(subscription.id)).status()).toBe(200);
    await BillingAssertions.stateMatches(await api.state(subscription.id), 'active', 2);

    const second = await (await api.create(new SubscriptionBuilder().withPlan('basic').build())).json();
    await api.configureProvider('decline');
    await api.charge(second.id);
    await api.charge(second.id);
    await BillingAssertions.stateMatches(await api.state(second.id), 'canceled', 2);
  });

  test('moves an active subscription to past_due after a refund', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    await api.charge(subscription.id);
    const refund = new WebhookBuilder(subscription.id, { invoice_id: 'inv_refund' })
      .withEventId('evt_refund')
      .withType('payment.refunded')
      .build();
    expect((await api.webhook(refund)).status()).toBe(200);
    await BillingAssertions.stateMatches(await api.state(subscription.id), 'past_due', 2);
  });

  test('changes an active subscription plan and persists the new pricing', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    await api.charge(subscription.id);
    const response = await api.changePlan(subscription.id, 'basic');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ plan: 'basic', price: 1900, trial_days: 14 });
    const state = await BillingAssertions.stateMatches(await api.state(subscription.id), 'active', 1);
    expect(state.audit_events.some(event => event.action === 'plan_changed_to_basic')).toBe(true);
  });

  test('does not persist or retry a timed-out provider charge', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    await api.configureProvider('timeout');
    expect((await api.charge(subscription.id)).status()).toBe(500);
    const state = await BillingAssertions.stateMatches(await api.state(subscription.id), 'trialing', 0);
    expect(state.provider_calls).toHaveLength(1);
  });

  test('cancels a trial and rejects a webhook that would reactivate it', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    expect((await api.cancel(subscription.id)).status()).toBe(200);
    const webhook = new WebhookBuilder(subscription.id).build();
    expect((await api.webhook(webhook)).status()).toBe(409);
    await BillingAssertions.stateMatches(await api.state(subscription.id), 'canceled', 0);
  });

  test('rejects invalid creation and webhook requests without provider calls', async () => {
    expect((await api.create({ customer_id: 'unknown', plan: 'gold' })).status()).toBe(400);
    expect((await api.webhook({ event_id: 'bad' }, 'wrong')).status()).toBe(401);
    expect((await api.webhook({ event_id: 'bad' })).status()).toBe(400);
  });

  test('processes duplicate delivery once and does not duplicate persistence', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    const webhook = new WebhookBuilder(subscription.id).withEventId('evt_duplicate').build();
    expect((await api.webhook(webhook)).status()).toBe(200);
    const duplicate = await api.webhook(webhook);
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);
    const state = await BillingAssertions.stateMatches(await api.state(subscription.id), 'active', 1);
    expect(state.webhook_events).toHaveLength(1);
    expect(state.audit_events.filter(event => event.action === 'payment.succeeded')).toHaveLength(1);
    expect(state.provider_calls).toHaveLength(0);
  });

  test('ignores an out-of-order failure after a successful invoice', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    const success = new WebhookBuilder(subscription.id).withInvoice('inv_ordered').build();
    const failure = new WebhookBuilder(subscription.id, { invoice_id: 'inv_ordered' })
      .withEventId('evt_late_failure')
      .withType('payment.failed')
      .build();
    await api.webhook(success);
    expect((await api.webhook(failure)).status()).toBe(200);
    const state = await BillingAssertions.stateMatches(await api.state(subscription.id), 'active', 1);
    expect(state.webhook_events).toHaveLength(2);
  });

  test('rejects canceling an already canceled subscription', async () => {
    const subscription = await (await api.create(new SubscriptionBuilder().build())).json();
    expect((await api.cancel(subscription.id)).status()).toBe(200);
    expect((await api.cancel(subscription.id)).status()).toBe(409);
  });
});