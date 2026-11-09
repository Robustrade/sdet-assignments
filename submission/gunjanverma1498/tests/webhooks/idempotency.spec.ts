import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

/**
 * Webhook idempotency: the provider may redeliver the same event_id. The
 * transition and all side effects must happen exactly once.
 */
describe('webhook idempotency (duplicate event_id)', () => {
  let env: TestEnvironment;
  let subscriptionId: string;

  beforeEach(async () => {
    env = TestEnvironment.setup();
    const created = await env.api.createSubscription(
      SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
    );
    subscriptionId = created.body.id;
  });

  it('applies the transition once and reports the redelivery as duplicate_ignored', async () => {
    const event = env
      .webhook()
      .withEventId('evt_same')
      .forSubscription(subscriptionId)
      .forInvoice('inv_1')
      .ofType('payment.succeeded')
      .build();

    const first = await env.api.postWebhook(event);
    const second = await env.api.postWebhook(event);

    expect(first.body.status).toBe('processed');
    expect(second.body.status).toBe('duplicate_ignored');
    expect(second.status).toBe(200);
    verify(env).persisted.subscriptionStatus(subscriptionId, 'active');
  });

  it('does not create duplicate invoice, event, or audit rows on redelivery', async () => {
    const event = env
      .webhook()
      .withEventId('evt_same')
      .forSubscription(subscriptionId)
      .forInvoice('inv_1')
      .ofType('payment.succeeded')
      .build();

    await env.api.postWebhook(event);
    const auditAfterFirst = env.db.eventLog.findBySubscription(subscriptionId).length;

    await env.api.postWebhook(event);
    await env.api.postWebhook(event);

    verify(env).persisted
      .invoiceCount(subscriptionId, 1)
      .paidInvoiceCount(subscriptionId, 1)
      .webhookEventCount(1)
      .auditEventCount(subscriptionId, auditAfterFirst); // no extra audit side effects
  });

  it('treats a duplicate payment.failed identically (single state change, single row)', async () => {
    const event = env
      .webhook()
      .withEventId('evt_fail')
      .forSubscription(subscriptionId)
      .forInvoice('inv_f')
      .ofType('payment.failed')
      .build();

    await env.api.postWebhook(event);
    await env.api.postWebhook(event);

    verify(env).persisted
      .subscriptionStatus(subscriptionId, 'past_due')
      .failedChargeCount(subscriptionId, 1) // incremented once, not twice
      .webhookEventCount(1);
  });
});
