import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ALL_STATUSES, ALL_TRIGGERS, IllegalTransitionError, SubscriptionStateMachine, TRANSITION_TABLE } from '../../src/state-machine.ts';
import { MAX_FAILED_ATTEMPTS } from '../../src/billing-service.ts';
import { TestEnvironment } from '../framework/TestEnvironment.ts';
import { WebhookEventBuilder as Hook } from '../framework/builders.ts';

describe('State machine (unit): the table is the only way to move', () => {
  it('every (status, trigger) pair outside the table is rejected', () => {
    for (const from of ALL_STATUSES) {
      for (const trigger of ALL_TRIGGERS) {
        const expected = TRANSITION_TABLE[from][trigger];
        if (expected) {
          assert.equal(SubscriptionStateMachine.next(from, trigger), expected);
        } else {
          assert.throws(() => SubscriptionStateMachine.next(from, trigger), IllegalTransitionError, `${from} --${trigger}-->`);
        }
      }
    }
  });

  it('canceled is terminal: no trigger leaves it', () => {
    for (const trigger of ALL_TRIGGERS) assert.equal(SubscriptionStateMachine.can('canceled', trigger), false);
  });

  it('table contains exactly the 7 documented transitions', () => {
    const count = ALL_STATUSES.reduce((n, s) => n + Object.keys(TRANSITION_TABLE[s]).length, 0);
    assert.equal(count, 7);
  });
});

describe('Lifecycle (end to end): every documented transition', () => {
  let env: TestEnvironment;
  beforeEach(async () => { env = await TestEnvironment.start(); });
  afterEach(async () => { env.verifyInvariants(); await env.stop(); });

  it('trialing -> active: trial ends, first charge succeeds (scheduler path)', async () => {
    const id = await env.subscriptionIn('trialing');
    const res = await env.api.advanceTrial(id);

    assert.equal(res.body.status, 'active');
    const invoice = env.onlyInvoiceOf(id);
    assert.equal(invoice.status, 'paid');
    assert.equal(invoice.amount, 4900); // pro price applied at billing, same as shown at creation
    assert.equal(env.provider.callCount, 1);
    assert.equal(env.provider.lastCall.amount, 4900);
    assert.deepEqual(env.db.audit.forSubscription(id).map((a) => a.to_status), ['trialing', 'active']);
    await env.expectApiMatchesDb(id);
  });

  it('trialing -> active: same transition driven by a payment.succeeded webhook', async () => {
    const id = await env.subscriptionIn('trialing');
    const res = await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id));

    assert.equal(res.body.status, 'applied');
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
    assert.equal(env.provider.callCount, 0, 'a webhook must never trigger a charge');
  });

  it('trialing -> past_due: trial ends, first charge declined', async () => {
    const id = await env.subscriptionIn('trialing');
    env.provider.nextDeclines();
    const res = await env.api.advanceTrial(id);

    assert.equal(res.body.status, 'past_due');
    const invoice = env.onlyInvoiceOf(id);
    assert.equal(invoice.status, 'failed', 'the failure is recorded');
    assert.equal(env.db.invoices.forSubscription(id).filter((i) => i.status === 'paid').length, 0, 'no success record');
    await env.expectApiMatchesDb(id);
  });

  it('active -> past_due: recurring charge fails (payment.failed webhook)', async () => {
    const id = await env.subscriptionIn('active');
    const res = await env.sendWebhook(Hook.aWebhook().failed().forSubscription(id));

    assert.equal(res.body.status, 'applied');
    assert.equal(env.db.subscriptions.find(id)?.status, 'past_due');
    assert.equal(env.db.invoices.forSubscription(id).filter((i) => i.status === 'failed').length, 1);
    await env.expectApiMatchesDb(id);
  });

  it('past_due -> active: retry charge succeeds (scheduler path)', async () => {
    const id = await env.subscriptionIn('past_due');
    env.provider.nextSucceeds();
    const res = await env.api.retryCharge(id);

    assert.equal(res.body.status, 'active');
    assert.equal(env.db.subscriptions.find(id)?.failed_attempts, 0, 'attempt counter resets');
    assert.deepEqual(env.db.invoices.forSubscription(id).map((i) => i.status).sort(), ['failed', 'paid']);
  });

  it('past_due -> active: retry success delivered by webhook', async () => {
    const id = await env.subscriptionIn('past_due');
    await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id));
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
  });

  it(`past_due -> canceled: retries exhausted after ${MAX_FAILED_ATTEMPTS} failed attempts`, async () => {
    const id = await env.subscriptionIn('past_due'); // failure #1
    env.provider.alwaysDecline();

    const retry1 = await env.api.retryCharge(id); // failure #2
    assert.equal(retry1.body.status, 'past_due');
    const retry2 = await env.api.retryCharge(id); // failure #3 => exhausted
    assert.equal(retry2.body.status, 'canceled');

    assert.equal(env.db.invoices.forSubscription(id).filter((i) => i.status === 'failed').length, MAX_FAILED_ATTEMPTS);
    const last = env.db.audit.forSubscription(id).at(-1)!;
    assert.equal(last.trigger, 'retries_exhausted');

    // and it is final: no more provider calls possible
    const callsBefore = env.provider.callCount;
    assert.equal((await env.api.retryCharge(id)).status, 409);
    assert.equal(env.provider.callCount, callsBefore);
  });

  it('active -> canceled: API cancel stops future billing', async () => {
    const id = await env.subscriptionIn('active');
    const res = await env.api.cancel(id);
    assert.equal(res.body.status, 'canceled');
    assert.equal((await env.api.advanceTrial(id)).status, 409);
    assert.equal((await env.api.retryCharge(id)).status, 409);
    assert.equal(env.provider.callCount, 0);
    await env.expectApiMatchesDb(id);
  });

  it('trialing -> canceled: API cancel before the trial ends means no charge ever', async () => {
    const id = await env.subscriptionIn('trialing');
    await env.api.cancel(id);
    assert.equal((await env.api.advanceTrial(id)).status, 409);
    assert.equal(env.provider.callCount, 0);
    assert.equal(env.db.invoices.count(), 0);
  });
});

describe('Lifecycle (end to end): invalid transitions are impossible', () => {
  let env: TestEnvironment;
  beforeEach(async () => { env = await TestEnvironment.start(); });
  afterEach(async () => { env.verifyInvariants(); await env.stop(); });

  it('canceled + stray payment.succeeded webhook does NOT reactivate, and records no paid invoice', async () => {
    const id = await env.subscriptionIn('canceled');
    const res = await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id));

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ignored');
    assert.equal(env.db.subscriptions.find(id)?.status, 'canceled');
    assert.equal(env.db.invoices.count(), 0);
    assert.equal(env.db.audit.forSubscription(id).at(-1)?.to_status, 'canceled');
    assert.equal(env.db.webhookEvents.all().at(-1)?.outcome, 'ignored', 'the ignored event is still audited');
    await env.expectApiMatchesDb(id);
  });

  it('canceled + payment.failed webhook is ignored too (no past_due)', async () => {
    const id = await env.subscriptionIn('canceled');
    const res = await env.sendWebhook(Hook.aWebhook().failed().forSubscription(id));
    assert.equal(res.body.status, 'ignored');
    assert.equal(env.db.subscriptions.find(id)?.status, 'canceled');
    assert.equal(env.db.invoices.count(), 0);
  });

  it('past_due cannot be canceled through the API (not in the lifecycle) => 409, state unchanged', async () => {
    const id = await env.subscriptionIn('past_due');
    const res = await env.api.cancel(id);
    assert.equal(res.status, 409);
    assert.equal(env.db.subscriptions.find(id)?.status, 'past_due');
  });

  it('active cannot be "trial-ended" or retried', async () => {
    const id = await env.subscriptionIn('active');
    assert.equal((await env.api.advanceTrial(id)).status, 409);
    assert.equal((await env.api.retryCharge(id)).status, 409);
    assert.equal(env.provider.callCount, 0);
  });
});

describe('Plan rules are applied consistently', () => {
  let env: TestEnvironment;
  beforeEach(async () => { env = await TestEnvironment.start(); });
  afterEach(async () => { env.verifyInvariants(); await env.stop(); });

  it('basic (no trial, 2900) vs pro (7-day trial, 4900): price at creation == price charged', async () => {
    const basic = await env.api.createSubscription({ customer_id: 'cust_001', plan: 'basic', payment_method_id: 'pm_x' });
    assert.equal(basic.body.status, 'active');
    assert.equal(env.provider.lastCall.amount, 2900);

    const pro = await env.api.createSubscription({ customer_id: 'cust_002', plan: 'pro', payment_method_id: 'pm_y' });
    assert.equal(pro.body.status, 'trialing');
    await env.api.advanceTrial(pro.body.id);
    assert.equal(env.provider.lastCall.amount, pro.body.amount);
    assert.equal(env.provider.lastCall.customerId, 'cust_002');
  });
});

describe('Provider timeouts leave state untouched', () => {
  let env: TestEnvironment;
  beforeEach(async () => { env = await TestEnvironment.start(); });
  afterEach(async () => { env.verifyInvariants(); await env.stop(); });

  it('timeout at trial end => 504, still trialing, no invoice, can be retried cleanly', async () => {
    const id = await env.subscriptionIn('trialing');
    env.provider.nextTimesOut();
    const res = await env.api.advanceTrial(id);

    assert.equal(res.status, 504);
    assert.equal(env.db.subscriptions.find(id)?.status, 'trialing');
    assert.equal(env.db.invoices.count(), 0);

    const again = await env.api.advanceTrial(id); // provider now succeeds
    assert.equal(again.body.status, 'active');
    assert.equal(env.provider.callCount, 2);
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
  });

  it('timeout on retry => 504, still past_due, failed_attempts NOT incremented', async () => {
    const id = await env.subscriptionIn('past_due');
    const before = env.db.subscriptions.find(id)!.failed_attempts;
    env.provider.nextTimesOut();

    assert.equal((await env.api.retryCharge(id)).status, 504);
    assert.equal(env.db.subscriptions.find(id)?.status, 'past_due');
    assert.equal(env.db.subscriptions.find(id)?.failed_attempts, before);
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
  });
});
