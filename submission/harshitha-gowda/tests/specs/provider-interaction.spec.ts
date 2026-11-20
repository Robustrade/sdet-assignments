import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TestEnvironment } from '../framework/TestEnvironment.ts';
import { SubscriptionRequestBuilder as Sub, WebhookEventBuilder as Hook } from '../framework/builders.ts';

let env: TestEnvironment;
beforeEach(async () => { env = await TestEnvironment.start(); });
afterEach(async () => { env.verifyInvariants(); await env.stop(); });

describe('Provider is called exactly once per real billing attempt, with the right arguments', () => {
  it('trial end: one call; amount, customer, payment method and idempotency key (= invoice id) are correct', async () => {
    const id = await env.subscriptionIn('trialing');
    await env.api.advanceTrial(id);

    assert.equal(env.provider.callCount, 1);
    assert.deepEqual(
      { ...env.provider.lastCall },
      { customerId: 'cust_001', paymentMethodId: 'pm_test_visa_4242', amount: 4900, currency: 'USD', idempotencyKey: env.onlyInvoiceOf(id).id },
    );
  });

  it('each retry is a NEW billing attempt with its own idempotency key', async () => {
    const id = await env.subscriptionIn('past_due');
    env.provider.alwaysDecline();
    await env.api.retryCharge(id);
    await env.api.retryCharge(id);

    assert.equal(env.provider.callCount, 2);
    const keys = env.provider.calls.map((c) => c.idempotencyKey);
    assert.equal(new Set(keys).size, 2);
    // every attempt that reached a decision is stored under the key that was sent to the provider
    for (const key of keys) assert.ok(env.db.invoices.find(key), `invoice ${key} must exist`);
  });
});

describe('Provider is NOT called when no charge is due', () => {
  it('rejected creation (validation errors)', async () => {
    await env.api.createSubscription(Sub.aSubscription().onPlan('nope').build());
    await env.api.createSubscription(Sub.aSubscription().without('customer_id').build());
    assert.equal(env.provider.callCount, 0);
  });

  it('pro creation (trial), cancellation, and every webhook type (incl. replays)', async () => {
    const id = await env.subscriptionIn('trialing');
    const evt = Hook.aWebhook().succeeded().forSubscription(id).withEventId('evt_replay');
    await env.sendWebhook(evt);
    await env.sendWebhook(evt); // replay
    await env.sendWebhook(Hook.aWebhook().failed().forSubscription(id));
    await env.sendWebhook(Hook.aWebhook().refunded().forSubscription(id));
    await env.api.cancel(id);

    assert.equal(env.provider.callCount, 0);
  });

  it('invalid webhooks (bad signature, malformed)', async () => {
    const id = await env.subscriptionIn('trialing');
    const payload = Hook.aWebhook().succeeded().forSubscription(id).build();
    for (const req of [env.webhooks.forged(payload), env.webhooks.unsigned(payload), env.webhooks.malformedJson()]) {
      await env.api.postWebhook(req.body, req.headers);
    }
    assert.equal(env.provider.callCount, 0);
  });
});

describe('Behaviour under each mocked provider outcome (trial-end charge)', () => {
  const outcomes: Array<[string, (e: TestEnvironment) => void, number, string, string[]]> = [
    ['success', (e) => e.provider.nextSucceeds(), 200, 'active', ['paid']],
    ['decline', (e) => e.provider.nextDeclines('insufficient_funds'), 200, 'past_due', ['failed']],
    ['timeout', (e) => e.provider.nextTimesOut(), 504, 'trialing', []],
  ];

  for (const [name, configure, httpStatus, finalStatus, invoiceStatuses] of outcomes) {
    it(name, async () => {
      const id = await env.subscriptionIn('trialing');
      configure(env);

      const res = await env.api.advanceTrial(id);

      assert.equal(res.status, httpStatus);
      assert.equal(env.db.subscriptions.find(id)?.status, finalStatus);
      assert.deepEqual(env.db.invoices.forSubscription(id).map((i) => i.status), invoiceStatuses);
      assert.equal(env.provider.callCount, 1);
      await env.expectApiMatchesDb(id);
    });
  }
});
