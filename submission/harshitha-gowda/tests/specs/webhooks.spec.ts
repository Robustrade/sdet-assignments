import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { TestEnvironment } from '../framework/TestEnvironment.ts';
import { WebhookEventBuilder as Hook } from '../framework/builders.ts';

let env: TestEnvironment;
beforeEach(async () => { env = await TestEnvironment.start(); });
afterEach(async () => { env.verifyInvariants(); await env.stop(); });

describe('Webhook idempotency (mandatory)', () => {
  it('same event_id delivered twice: transition once, ONE invoice, duplicate recorded, no provider call', async () => {
    const id = await env.subscriptionIn('trialing');
    const event = Hook.aWebhook().succeeded().forSubscription(id).withEventId('evt_dup_1');

    const first = await env.sendWebhook(event);
    const second = await env.sendWebhook(event);

    assert.equal(first.body.status, 'applied');
    assert.equal(second.status, 200, 'redelivery must still be ACKed or the provider will keep retrying');
    assert.equal(second.body.status, 'duplicate');

    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
    assert.deepEqual(env.db.webhookEvents.byEventId('evt_dup_1').map((e) => e.outcome), ['applied', 'duplicate']);
    assert.deepEqual(env.db.audit.forSubscription(id).map((a) => a.to_status), ['trialing', 'active'], 'exactly one transition');
    assert.equal(env.provider.callCount, 0);
  });

  it('a redelivered payment.failed does not double-count attempts or cancel early', async () => {
    const id = await env.subscriptionIn('past_due'); // attempts = 1
    const event = Hook.aWebhook().failed().forSubscription(id).withEventId('evt_fail_dup');

    await env.sendWebhook(event);
    await env.sendWebhook(event);
    await env.sendWebhook(event);

    const sub = env.db.subscriptions.find(id)!;
    assert.equal(sub.status, 'past_due');
    assert.equal(sub.failed_attempts, 2, 'counted once, not three times');
    assert.equal(env.db.invoices.forSubscription(id).filter((i) => i.status === 'failed').length, 2);
  });

  it('different event_ids for the SAME invoice do not create a second invoice row', async () => {
    const id = await env.subscriptionIn('active');
    const invoice = Hook.aWebhook().succeeded().forSubscription(id).forInvoice('inv_recurring_1');

    await env.sendWebhook(invoice.withEventId('evt_a'));
    const again = await env.sendWebhook(invoice.withEventId('evt_b'));

    assert.equal(again.body.status, 'ignored');
    assert.equal(env.db.invoices.forSubscription(id).filter((i) => i.id === 'inv_recurring_1').length, 1);
  });

  it('a webhook for a charge the service already made synchronously is a no-op (no 2nd invoice, no 2nd charge)', async () => {
    const id = await env.subscriptionIn('trialing');
    await env.api.advanceTrial(id);
    const invoice = env.onlyInvoiceOf(id);

    const res = await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id).forInvoice(invoice.id));

    assert.equal(res.body.status, 'ignored');
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
    assert.equal(env.provider.callCount, 1, 'only the original billing attempt hit the provider');
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
  });

  it('BONUS: two identical webhooks fired concurrently still apply exactly once', async () => {
    const id = await env.subscriptionIn('trialing');
    const event = Hook.aWebhook().succeeded().forSubscription(id).withEventId('evt_race');

    const [a, b] = await Promise.all([env.sendWebhook(event), env.sendWebhook(event)]);

    assert.deepEqual([a.body.status, b.body.status].sort(), ['applied', 'duplicate']);
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
    assert.equal(env.db.audit.forSubscription(id).length, 2);
  });
});

describe('Out-of-order delivery', () => {
  it('payment.failed arriving AFTER payment.succeeded (same invoice) does not regress active', async () => {
    const id = await env.subscriptionIn('trialing');
    const invoiceId = 'inv_ooo_1';

    await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id).forInvoice(invoiceId));
    const late = await env.sendWebhook(Hook.aWebhook().failed().forSubscription(id).forInvoice(invoiceId));

    assert.equal(late.body.status, 'ignored');
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
    assert.equal(env.db.invoices.find(invoiceId)?.status, 'paid', 'a paid invoice is never downgraded to failed');
    assert.deepEqual(env.db.audit.forSubscription(id).map((a) => a.to_status), ['trialing', 'active']);
  });

  it('payment.failed then payment.succeeded for the same invoice (a provider retry) recovers to active', async () => {
    const id = await env.subscriptionIn('trialing');
    const invoiceId = 'inv_retry_1';

    await env.sendWebhook(Hook.aWebhook().failed().forSubscription(id).forInvoice(invoiceId));
    assert.equal(env.db.subscriptions.find(id)?.status, 'past_due');

    await env.sendWebhook(Hook.aWebhook().succeeded().forSubscription(id).forInvoice(invoiceId));
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
    assert.equal(env.db.invoices.find(invoiceId)?.status, 'paid');
    assert.equal(env.db.invoices.forSubscription(id).length, 1);
  });

  it('payment.refunded before the payment ever existed is ignored', async () => {
    const id = await env.subscriptionIn('active');
    const res = await env.sendWebhook(Hook.aWebhook().refunded().forSubscription(id).forInvoice('inv_never_paid'));
    assert.equal(res.body.status, 'ignored');
    assert.equal(env.db.invoices.find('inv_never_paid'), undefined);
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
  });
});

describe('Refunds', () => {
  it('refund marks the paid invoice refunded and leaves the lifecycle state alone', async () => {
    const id = await env.subscriptionIn('trialing');
    await env.api.advanceTrial(id);
    const invoice = env.onlyInvoiceOf(id);

    const res = await env.sendWebhook(Hook.aWebhook().refunded().forSubscription(id).forInvoice(invoice.id));

    assert.equal(res.body.status, 'applied');
    assert.equal(env.db.invoices.find(invoice.id)?.status, 'refunded');
    assert.equal(env.db.subscriptions.find(id)?.status, 'active');
  });

  it('a second refund event for an already-refunded invoice is ignored', async () => {
    const id = await env.subscriptionIn('trialing');
    await env.api.advanceTrial(id);
    const invoice = env.onlyInvoiceOf(id);

    await env.sendWebhook(Hook.aWebhook().refunded().forSubscription(id).forInvoice(invoice.id));
    const again = await env.sendWebhook(Hook.aWebhook().refunded().forSubscription(id).forInvoice(invoice.id));
    assert.equal(again.body.status, 'ignored');
  });
});
