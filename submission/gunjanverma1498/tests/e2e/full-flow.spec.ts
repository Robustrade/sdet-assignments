import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * End-to-end flows that exercise the full path (API request / webhook ->
 * service -> persistence -> provider) and assert coherence at every stage.
 */
describe('end-to-end billing flows', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  it('trial -> active -> recurring charge -> recurring failure -> retry success', async () => {
    // Create a trial subscription; no charge yet.
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    const id = created.body.id;
    verify(env).persisted.subscriptionStatus(id, 'trialing');
    verify(env).provider.wasNotCharged();

    // Trial ends, first charge succeeds (provider notifies us).
    await env.api.postWebhook(
      env.webhook().withEventId('evt_first').forSubscription(id).forInvoice('inv_1').ofType('payment.succeeded').build(),
    );
    await verify(env).persisted.subscriptionStatus(id, 'active').noContradictoryRecords(id);
    await verify(env).persisted.apiAndDbAgree(id);

    // Next billing cycle succeeds -> stays active, new paid invoice.
    await env.api.postWebhook(
      env.webhook().withEventId('evt_cycle2').forSubscription(id).forInvoice('inv_2').ofType('payment.succeeded').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'active').paidInvoiceCount(id, 2);

    // Following cycle fails -> past_due.
    await env.api.postWebhook(
      env.webhook().withEventId('evt_cycle3_fail').forSubscription(id).forInvoice('inv_3').ofType('payment.failed').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'past_due').failedChargeCount(id, 1);

    // Retry succeeds -> back to active, counter reset.
    await env.api.postWebhook(
      env.webhook().withEventId('evt_retry_ok').forSubscription(id).forInvoice('inv_4').ofType('payment.succeeded').build(),
    );
    verify(env).persisted
      .subscriptionStatus(id, 'active')
      .failedChargeCount(id, 0)
      .paidInvoiceCount(id, 3)
      .noContradictoryRecords(id);

    // The provider is never called by webhook processing — only we initiate charges.
    verify(env).provider.wasNotCharged();
  });

  it('dunning to cancellation, then stray webhooks are ignored forever', async () => {
    // Immediate-charge plan that declines on creation -> past_due.
    env.provider.willReturn('decline');
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
    );
    const id = created.body.id;
    verify(env).provider.chargedExactlyOnce();
    verify(env).persisted.subscriptionStatus(id, 'past_due').failedChargeCount(id, 1);

    // Retry attempts (as webhooks) keep failing until retries are exhausted.
    await env.api.postWebhook(
      env.webhook().withEventId('evt_r1').forSubscription(id).forInvoice('inv_r1').ofType('payment.failed').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'past_due').failedChargeCount(id, 2);

    await env.api.postWebhook(
      env.webhook().withEventId('evt_r2').forSubscription(id).forInvoice('inv_r2').ofType('payment.failed').build(),
    );
    verify(env).persisted.subscriptionStatus(id, 'canceled');

    // A late "payment succeeded" must NOT bring a canceled subscription back.
    const stray = await env.api.postWebhook(
      env.webhook().withEventId('evt_zombie').forSubscription(id).forInvoice('inv_z').ofType('payment.succeeded').build(),
    );
    expect(stray.body.status).toBe('ignored');
    verify(env).persisted
      .subscriptionStatus(id, 'canceled')
      .paidInvoiceCount(id, 0)
      .noContradictoryRecords(id);
    await verify(env).persisted.apiAndDbAgree(id);
  });
});
