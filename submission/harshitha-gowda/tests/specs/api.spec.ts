import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TestEnvironment } from '../framework/TestEnvironment.ts';
import { SubscriptionRequestBuilder as Sub, WebhookEventBuilder as Hook } from '../framework/builders.ts';

let env: TestEnvironment;
beforeEach(async () => { env = await TestEnvironment.start(); });
afterEach(async () => { env.verifyInvariants(); await env.stop(); });

describe('API: subscription creation', () => {
  it('pro plan starts in trialing, is NOT charged, and API matches DB', async () => {
    const res = await env.api.createSubscription(Sub.aSubscription().onPlan('pro').build());

    assert.equal(res.status, 201);
    assert.match(res.body.id, /^sub_/);
    assert.equal(res.body.status, 'trialing');
    assert.equal(res.body.plan, 'pro');
    assert.equal(res.body.amount, 4900);
    assert.equal(res.body.trial_ends_at, '2026-01-08T00:00:00.000Z'); // 7-day trial from the fixed clock
    assert.equal(env.provider.callCount, 0);
    assert.equal(env.db.invoices.count(), 0);
    await env.expectApiMatchesDb(res.body.id);
  });

  it('basic plan is charged immediately: active, one paid invoice, provider called once with exact args', async () => {
    const res = await env.api.createSubscription(Sub.aSubscription().onPlan('basic').build());

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.trial_ends_at, null);

    assert.equal(env.provider.callCount, 1);
    const invoice = env.onlyInvoiceOf(res.body.id);
    assert.deepEqual(
      { ...env.provider.lastCall },
      { customerId: 'cust_001', paymentMethodId: 'pm_test_visa_4242', amount: 2900, currency: 'USD', idempotencyKey: invoice.id },
    );
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.amount, 2900);
    await env.expectApiMatchesDb(res.body.id);
  });

  it('basic plan + provider decline => 402 and NOTHING is persisted', async () => {
    env.provider.alwaysDecline();
    const res = await env.api.createSubscription(Sub.aSubscription().onPlan('basic').build());

    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'payment_declined');
    assert.equal(env.provider.callCount, 1);
    assert.equal(env.db.subscriptions.count(), 0);
    assert.equal(env.db.invoices.count(), 0);
  });

  it('basic plan + provider timeout => 504 and NOTHING is persisted', async () => {
    env.provider.alwaysTimeout();
    const res = await env.api.createSubscription(Sub.aSubscription().onPlan('basic').build());

    assert.equal(res.status, 504);
    assert.equal(res.body.error.code, 'provider_timeout');
    assert.equal(env.db.subscriptions.count(), 0);
    assert.equal(env.db.invoices.count(), 0);
  });
});

describe('API: validation failures persist nothing and never call the provider', () => {
  const cases: Array<[string, () => object, number, string]> = [
    ['unknown plan', () => Sub.aSubscription().onPlan('platinum').build(), 422, 'unknown_plan'],
    ['missing customer_id', () => Sub.aSubscription().without('customer_id').build(), 400, 'validation_error'],
    ['missing plan', () => Sub.aSubscription().without('plan').build(), 400, 'validation_error'],
    ['missing payment_method_id', () => Sub.aSubscription().without('payment_method_id').build(), 400, 'validation_error'],
    ['malformed payment_method_id', () => Sub.aSubscription().withPaymentMethod('card_123').build(), 400, 'validation_error'],
    ['unknown customer', () => Sub.aSubscription().forCustomer('cust_nope').onPlan('basic').build(), 404, 'unknown_customer'],
  ];

  for (const [name, body, status, code] of cases) {
    it(name, async () => {
      const res = await env.api.createSubscription(body());
      assert.equal(res.status, status);
      assert.equal(res.body.error.code, code);
      assert.equal(env.provider.callCount, 0);
      assert.equal(env.db.subscriptions.count(), 0);
      assert.equal(env.db.invoices.count(), 0);
    });
  }
});

describe('API: retrieval and cancellation', () => {
  it('GET returns the subscription; unknown id is 404', async () => {
    const id = await env.subscriptionIn('trialing');
    assert.equal((await env.api.getSubscription(id)).status, 200);
    assert.equal((await env.api.getSubscription('sub_missing')).status, 404);
  });

  it('cancel works once; canceling again is 409 and adds no audit row', async () => {
    const id = await env.subscriptionIn('trialing');
    const first = await env.api.cancel(id);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'canceled');
    const auditBefore = env.db.audit.forSubscription(id).length;

    const second = await env.api.cancel(id);
    assert.equal(second.status, 409);
    assert.equal(env.db.audit.forSubscription(id).length, auditBefore);
    assert.equal(env.provider.callCount, 0);
    await env.expectApiMatchesDb(id);
  });
});

describe('API: webhook endpoint request handling', () => {
  async function expectRejected(req: { body: string; headers: Record<string, string> }, status: number, subId: string) {
    const res = await env.api.postWebhook(req.body, req.headers);
    assert.equal(res.status, status);
    assert.equal(env.db.webhookEvents.count(), 0, 'rejected requests must not be recorded as events');
    assert.equal(env.db.invoices.count(), 0);
    assert.equal(env.db.subscriptions.find(subId)?.status, 'trialing');
  }

  it('valid signature => 200', async () => {
    const id = await env.subscriptionIn('trialing');
    const res = await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'applied');
  });

  it('missing signature => 401', async () => {
    const id = await env.subscriptionIn('trialing');
    await expectRejected(env.webhooks.unsigned(Hook.aWebhook().succeeded().forSubscription(id).build()), 401, id);
  });

  it('forged signature => 401', async () => {
    const id = await env.subscriptionIn('trialing');
    await expectRejected(env.webhooks.forged(Hook.aWebhook().succeeded().forSubscription(id).build()), 401, id);
  });

  it('body tampered after signing => 401', async () => {
    const id = await env.subscriptionIn('trialing');
    await expectRejected(env.webhooks.tampered(Hook.aWebhook().succeeded().forSubscription(id).build()), 401, id);
  });

  it('validly signed but malformed JSON => 400', async () => {
    const id = await env.subscriptionIn('trialing');
    await expectRejected(env.webhooks.malformedJson(), 400, id);
  });

  it('validly signed but missing required field / unsupported type => 400', async () => {
    const id = await env.subscriptionIn('trialing');
    const base = () => Hook.aWebhook().succeeded().forSubscription(id);
    await expectRejected(env.webhooks.signed(base().without('event_id').build()), 400, id);
    await expectRejected(env.webhooks.signed(base().without('invoice_id').build()), 400, id);
    await expectRejected(env.webhooks.signed(base().withType('payment.exploded').build()), 400, id);
  });

  it('event for an unknown subscription => 404 and nothing recorded', async () => {
    const res = await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription('sub_missing'));
    assert.equal(res.status, 404);
    assert.equal(env.db.webhookEvents.count(), 0);
    assert.equal(env.db.invoices.count(), 0);
  });
});
