import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { SubscriptionAssertions } from '../framework/assertions/SubscriptionAssertions.js';
import { InvoiceAssertions } from '../framework/assertions/InvoiceAssertions.js';
import { ProviderAssertions } from '../framework/assertions/ProviderAssertions.js';

describe('Webhook idempotency and out-of-order delivery', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('delivers the same event_id twice → exactly one transition, one invoice row', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_dup_1')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_dup_1')
      .withAmount(1900)
      .build();

    const first = await env.webhookSimulator.deliver(payload);
    const second = await env.webhookSimulator.deliver(payload);

    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe('processed');
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe('duplicate');

    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'active');
    InvoiceAssertions.expectExactlyOneInvoiceFor(id, env.invoices.forSubscription(id));
    expect(env.webhookEvents.count()).toBe(1);
  });

  it('a duplicate event does not trigger an extra provider charge', async () => {
    env.provider.willSucceed();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;
    const baseline = env.provider.callCount;

    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_dup_charge')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_dup_charge')
      .build();

    await env.webhookSimulator.deliver(payload);
    await env.webhookSimulator.deliver(payload);

    ProviderAssertions.expectNoFurtherCalls(env.provider, baseline);
  });

  it('a stale payment.failed after payment.succeeded for the same invoice does not regress active state', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const succeeded = new WebhookPayloadBuilder()
      .withEventId('evt_ok_1')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_stale')
      .withAmount(1900)
      .build();
    const staleFailed = new WebhookPayloadBuilder()
      .withEventId('evt_stale_1')
      .ofType('payment.failed')
      .forSubscription(id)
      .forInvoice('inv_stale')
      .withAmount(1900)
      .build();

    const first = await env.webhookSimulator.deliver(succeeded);
    expect(first.body.outcome).toBe('processed');

    const stale = await env.webhookSimulator.deliver(staleFailed);
    expect(stale.status).toBe(200);
    expect(stale.body.outcome).toBe('noop_stale_failed');

    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'active');
    const invoices = env.invoices.forSubscription(id);
    expect(invoices.filter((i) => i.status === 'failed')).toHaveLength(0);
    expect(env.webhookEvents.hasProcessed('evt_stale_1')).toBe(true);
  });

  it('a replayed webhook after cancellation cannot revive a canceled subscription', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    await env.apiClient.cancelSubscription(id);

    const res = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_after_cancel')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_after_cancel')
        .build(),
    );

    expect(res.body.outcome).toBe('noop_illegal');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'canceled');
    expect(env.invoices.forSubscription(id)).toHaveLength(0);
    expect(env.webhookEvents.hasProcessed('evt_after_cancel')).toBe(true);
  });

  it('out-of-order delivery with distinct invoices still lands in the correct final state', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const trialFailed = new WebhookPayloadBuilder()
      .withEventId('evt_ooo_fail')
      .ofType('payment.failed')
      .forSubscription(id)
      .forInvoice('inv_ooo_1')
      .build();
    const retrySucceeded = new WebhookPayloadBuilder()
      .withEventId('evt_ooo_ok')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_ooo_2')
      .build();

    const failRes = await env.webhookSimulator.deliver(trialFailed);
    expect(failRes.body.outcome).toBe('processed');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'past_due');

    const okRes = await env.webhookSimulator.deliver(retrySucceeded);
    expect(okRes.body.outcome).toBe('processed');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'active');

    const invoices = env.invoices.forSubscription(id);
    expect(invoices).toHaveLength(2);
    expect(invoices.map((i) => i.status).sort()).toEqual(['failed', 'succeeded']);
  });

  it('an event for an unknown subscription is handled safely without orphan side effects', async () => {
    const res = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_unknown_sub')
        .ofType('payment.succeeded')
        .forSubscription('sub_nope')
        .forInvoice('inv_nope')
        .build(),
    );

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('noop_unknown_subscription');
    expect(env.invoices.forSubscription('sub_nope')).toHaveLength(0);
    expect(env.webhookEvents.hasProcessed('evt_unknown_sub')).toBe(true);
  });
});