import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * Out-of-order and stale webhook delivery. Protection is keyed on invoice state,
 * not just the event_id, so a late failure for an already-paid invoice (even with
 * a fresh event_id) cannot regress the subscription.
 */
describe('out-of-order / stale webhook delivery', () => {
  let env: TestEnvironment;
  let subscriptionId: string;

  beforeEach(async () => {
    env = TestEnvironment.setup();
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    subscriptionId = created.body.id;
  });

  it('a payment.failed arriving after payment.succeeded (same invoice) does not regress to past_due', async () => {
    await env.api.postWebhook(
      env.webhook().withEventId('evt_ok').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );
    verify(env).persisted.subscriptionStatus(subscriptionId, 'active');

    const stale = await env.api.postWebhook(
      // fresh event_id, same invoice — not caught by event_id dedup, caught by invoice state
      env.webhook().withEventId('evt_late_fail').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.failed').build(),
    );

    expect(stale.body.status).toBe('ignored');
    verify(env).persisted
      .subscriptionStatus(subscriptionId, 'active')
      .invoiceStatus('inv_1', 'paid')
      .noContradictoryRecords(subscriptionId);
  });

  it('a duplicate-by-invoice payment.succeeded (new event_id) does not create a second paid invoice', async () => {
    await env.api.postWebhook(
      env.webhook().withEventId('evt_1').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );
    const second = await env.api.postWebhook(
      env.webhook().withEventId('evt_2').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );

    expect(second.body.status).toBe('ignored');
    verify(env).persisted.invoiceCount(subscriptionId, 1).paidInvoiceCount(subscriptionId, 1);
  });

  it('a refund after a successful payment is recorded without changing the lifecycle', async () => {
    await env.api.postWebhook(
      env.webhook().withEventId('evt_pay').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );

    await env.api.postWebhook(
      env.webhook().withEventId('evt_refund').forSubscription(subscriptionId).forInvoice('inv_1').ofType('payment.refunded').build(),
    );

    verify(env).persisted.subscriptionStatus(subscriptionId, 'active').invoiceStatus('inv_1', 'refunded');
  });
});
