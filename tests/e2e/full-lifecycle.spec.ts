import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { SubscriptionAssertions } from '../framework/assertions/SubscriptionAssertions.js';
import { InvoiceAssertions } from '../framework/assertions/InvoiceAssertions.js';
import { ProviderAssertions } from '../framework/assertions/ProviderAssertions.js';

describe('E2E — full subscription lifecycle across all layers', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('walks trialing → active → past_due → active → canceled with cancel irreversible', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    expect(created.body.status).toBe('trialing');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'trialing');

    ProviderAssertions.expectNeverCalled(env.provider);

    const succeeded1 = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_1')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_1')
        .withAmount(1900)
        .build(),
    );
    expect(succeeded1.body.outcome).toBe('processed');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'active');
    const get1 = await env.apiClient.getSubscription(id);
    expect(get1.status).toBe(200);
    expect(get1.body.status).toBe('active');

    const failed = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_2')
        .ofType('payment.failed')
        .forSubscription(id)
        .forInvoice('inv_2')
        .build(),
    );
    expect(failed.body.outcome).toBe('processed');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'past_due');

    const succeeded2 = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_3')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_3')
        .build(),
    );
    expect(succeeded2.body.outcome).toBe('processed');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'active');

    const cancelRes = await env.apiClient.cancelSubscription(id);
    expect(cancelRes.body.status).toBe('canceled');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'canceled');

    const doubleCancel = await env.apiClient.cancelSubscription(id);
    expect(doubleCancel.status).toBe(409);

    const revived = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_4')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_4')
        .build(),
    );
    expect(revived.body.outcome).toBe('noop_illegal');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'canceled');

    const invoices = env.invoices.forSubscription(id);
    expect(invoices).toHaveLength(3);
    expect(invoices.map((i) => i.status).sort()).toEqual(['failed', 'succeeded', 'succeeded']);

    expect(env.webhookEvents.count()).toBe(4);
    const api = await env.apiClient.getSubscription(id);
    expect(api.body.status).toBe('canceled');
    InvoiceAssertions.expectNoDuplicateInvoiceFor(id, 'inv_1', invoices);
  });
});