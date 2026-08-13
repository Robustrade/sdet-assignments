import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { SubscriptionAssertions } from '../framework/assertions/SubscriptionAssertions.js';

describe('Subscription persistence matches API at every stage', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('subscription row matches the API response at creation (trialing)', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const row = env.subscriptions.findById(id);
    expect(row).toBeDefined();
    expect(row!.id).toBe(id);
    expect(row!.customerId).toBe(created.body.customer_id);
    expect(row!.plan).toBe('basic');
    SubscriptionAssertions.expectState(row, 'trialing');
  });

  it('subscription row state matches API after a webhook transition', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_persist_1')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_persist_1')
        .withAmount(1900)
        .build(),
    );

    const viaApi = await env.apiClient.getSubscription(id);
    const row = env.subscriptions.findById(id);
    expect(row!.state).toBe('active');
    expect(viaApi.body.status).toBe('active');
  });

  it('subscription row state matches after cancellation', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    await env.apiClient.cancelSubscription(id);
    const row = env.subscriptions.findById(id);
    SubscriptionAssertions.expectState(row, 'canceled');

    const viaApi = await env.apiClient.getSubscription(id);
    expect(viaApi.body.status).toBe('canceled');
  });

  it('an active subscription always has a succeeded invoice on record', async () => {
    env.provider.willSucceed();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;

    const invoices = env.invoices.forSubscription(id);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0]!.status).toBe('succeeded');
    expect(invoices[0]!.amount).toBe(4900);
    expect(invoices[0]!.currency).toBe('USD');
    expect(invoices[0]!.providerRef).toBeTruthy();
  });
});