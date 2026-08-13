import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { WebhookPayloadBuilder } from '../builders/WebhookPayloadBuilder.js';
import { ProviderAssertions } from '../framework/assertions/ProviderAssertions.js';
import { PRO_PLAN } from '../data/plans.fixture.js';

describe('Mocked payment provider interaction', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('is called exactly once per real billing attempt with the correct arguments', async () => {
    env.provider.willSucceed();
    await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );

    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, {
      customerId: 'cust_001',
      amount: PRO_PLAN.price,
      currency: 'USD',
      paymentMethodId: 'pm_test_visa_4242',
    });
    expect(env.provider.calls[0]!.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('is not called for a plan with a trial (no immediate charge)', async () => {
    await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('is not called for a rejected creation (unknown plan)', async () => {
    await env.apiClient.createSubscription(
      { customer_id: 'cust_001', plan: 'enterprise', payment_method_id: 'pm_test' },
    );
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('is not called for a rejected creation (missing payment method)', async () => {
    await env.apiClient.createSubscription(
      { customer_id: 'cust_001', plan: 'pro', payment_method_id: undefined },
    );
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('is not called when a webhook is replayed (duplicate event)', async () => {
    env.provider.willSucceed();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;
    const baseline = env.provider.callCount;

    const payload = new WebhookPayloadBuilder()
      .withEventId('evt_provider_dup')
      .ofType('payment.succeeded')
      .forSubscription(id)
      .forInvoice('inv_provider_dup')
      .build();

    await env.webhookSimulator.deliver(payload);
    await env.webhookSimulator.deliver(payload);

    ProviderAssertions.expectNoFurtherCalls(env.provider, baseline);
  });

  it('is not called for a no-op transition on a canceled subscription', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;
    await env.apiClient.cancelSubscription(id);

    const res = await env.webhookSimulator.deliver(
      new WebhookPayloadBuilder()
        .withEventId('evt_provider_canceled')
        .ofType('payment.succeeded')
        .forSubscription(id)
        .forInvoice('inv_provider_canceled')
        .build(),
    );

    expect(res.body.outcome).toBe('noop_illegal');
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('maps a decline to past_due with exactly one call', async () => {
    env.provider.willDecline();
    const res = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    expect(res.body.status).toBe('past_due');
    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, { amount: PRO_PLAN.price });
  });

  it('maps a timeout to past_due with exactly one call', async () => {
    env.provider.willTimeout();
    const res = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    expect(res.body.status).toBe('past_due');
    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, { amount: PRO_PLAN.price });
  });
});