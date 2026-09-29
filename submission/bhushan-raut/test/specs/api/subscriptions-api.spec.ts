import { describe, expect, it } from 'vitest';
import { aCustomer } from '../../framework/builders/CustomerBuilder';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Subscription creation', () => {
  const env = useTestEnvironment();

  it('A1: basic plan starts trialing for 14 days and charges nothing yet', async () => {
    const customer = env().seedCustomer();
    const now = env().clock.now();

    const res = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      customer_id: customer.id,
      payment_method_id: customer.paymentMethodId,
      plan: 'basic',
      status: 'trialing',
      trial_ends_at: new Date(now.getTime() + 14 * DAY_MS).toISOString(),
      current_period_end: null,
      retry_count: 0,
      canceled_at: null,
    });
    expect(res.body.id).toMatch(/^sub_/);
    await env().assert.expectConsistent(res.body.id);
    expect(env().assert.transitionsOf(res.body.id)).toEqual(['∅->trialing']);
    expect(env().db.invoicesFor(res.body.id)).toEqual([]);
    expect(env().provider.calls).toHaveLength(0);
  });

  it('A2: pro plan is charged at signup and becomes active when the charge succeeds', async () => {
    const customer = env().seedCustomer();
    env().provider.willSucceed();

    const res = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.trial_ends_at).toBe(res.body.created_at);
    expect(res.body.current_period_end).toBe(new Date(env().clock.now().getTime() + 30 * DAY_MS).toISOString());
    await env().assert.expectConsistent(res.body.id);
    expect(env().assert.transitionsOf(res.body.id)).toEqual(['∅->trialing', 'trialing->active']);

    const [invoice] = env().db.invoicesFor(res.body.id);
    expect(invoice).toMatchObject({ amount: 4900, currency: 'USD', status: 'paid' });
    expect(env().db.attemptsFor(res.body.id)).toEqual([
      expect.objectContaining({ invoice_id: invoice!.id, attempt_no: 1, status: 'succeeded', provider_ref: 'ch_mock_1' }),
    ]);
    expect(env().notifier.activationsFor(res.body.id)).toBe(1);
  });

  it('A3: pro plan whose signup charge is declined is created past_due, with the failure recorded', async () => {
    const customer = env().seedCustomer();
    env().provider.willDecline('insufficient_funds');

    const res = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    await env().assert.expectConsistent(res.body.id);
    expect(env().db.invoicesFor(res.body.id).map((i) => i.status)).toEqual(['failed']);
    expect(env().db.attemptsFor(res.body.id).map((a) => a.status)).toEqual(['failed']);
    expect(env().db.query('SELECT decline_code FROM payment_attempts')).toEqual([{ decline_code: 'insufficient_funds' }]);
    expect(env().notifier.activationsFor(res.body.id)).toBe(0);
  });

  it('A4: pro signup charge that times out stays trialing until the provider webhook settles it', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();

    expect(env().db.invoicesFor(subscription.id).map((i) => i.status)).toEqual(['open']);
    expect(env().db.attemptsFor(subscription.id).map((a) => a.status)).toEqual(['pending']);

    await env().webhooks.deliver(env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build()));

    const view = await env().assert.expectConsistent(subscription.id);
    expect(view.status).toBe('active');
    expect(env().db.invoicesFor(subscription.id).map((i) => i.status)).toEqual(['paid']);
    expect(env().notifier.activationsFor(subscription.id)).toBe(1);
  });

  it('GET returns 404 for an unknown subscription', async () => {
    const res = await env().api.get('sub_does_not_exist');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('not_found');
  });
});

describe('Subscription creation rejects invalid requests without side effects', () => {
  const env = useTestEnvironment();

  async function expectRejected(body: unknown, expected: { status: number; code: string; field?: string }) {
    const before = env().db.snapshotCounts();

    const res = await env().api.create(body);

    expect(res.status).toBe(expected.status);
    expect(res.body.error).toMatchObject({ code: expected.code, ...(expected.field && { field: expected.field }) });
    expect(env().db.snapshotCounts(), 'nothing persisted').toEqual(before);
    expect(env().provider.calls, 'provider never called').toHaveLength(0);
  }

  it('B1: unknown plan -> 422', async () => {
    const customer = env().seedCustomer();
    await expectRejected(aSubscriptionRequest().forCustomer(customer).onPlan('platinum').build(), {
      status: 422,
      code: 'unknown_plan',
      field: 'plan',
    });
  });

  it.each(['customer_id', 'plan', 'payment_method_id'])('B2: missing %s -> 400', async (field) => {
    const customer = env().seedCustomer();
    await expectRejected(aSubscriptionRequest().forCustomer(customer).onPlan('pro').without(field).build(), {
      status: 400,
      code: 'validation_error',
      field,
    });
  });

  it('B2: blank customer_id -> 400', async () => {
    const customer = env().seedCustomer();
    await expectRejected(aSubscriptionRequest().forCustomer(customer).with('customer_id', '  ').build(), {
      status: 400,
      code: 'validation_error',
      field: 'customer_id',
    });
  });

  it('B3: unknown customer -> 422', async () => {
    await expectRejected(aSubscriptionRequest().forCustomer(aCustomer().build()).onPlan('pro').build(), {
      status: 422,
      code: 'unknown_customer',
      field: 'customer_id',
    });
  });

  it("B4: another customer's payment method -> 422", async () => {
    const alice = env().seedCustomer();
    const mallory = env().seedCustomer();
    await expectRejected(
      aSubscriptionRequest().forCustomer(mallory).onPlan('pro').with('payment_method_id', alice.paymentMethodId).build(),
      { status: 422, code: 'invalid_payment_method', field: 'payment_method_id' },
    );
  });

  it('B4: malformed JSON body -> 400', async () => {
    const before = env().db.snapshotCounts();
    const res = await env().api.createRaw('{"plan": "pro",');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('malformed_json');
    expect(env().db.snapshotCounts()).toEqual(before);
  });

  it('B5: canceling an already-canceled subscription -> 409, nothing changes', async () => {
    const sub = await env().given.trialingSubscription();
    const first = await env().api.cancel(sub.id);
    const before = env().db.snapshotCounts();

    const second = await env().api.cancel(sub.id);

    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('invalid_transition');
    expect(env().db.snapshotCounts()).toEqual(before);
    expect((await env().assert.expectConsistent(sub.id)).canceled_at).toBe(first.body.canceled_at);
  });

  it('B5: canceling an unknown subscription -> 404', async () => {
    const res = await env().api.cancel('sub_does_not_exist');
    expect(res.status).toBe(404);
  });
});
