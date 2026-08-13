import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { ProviderAssertions } from '../framework/assertions/ProviderAssertions.js';

describe('POST /subscriptions — validation failures', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('rejects an unknown plan with no persistence and no provider call', async () => {
    const body = new SubscriptionRequestBuilder().build();
    const res = await env.apiClient.createSubscription({ ...body, plan: 'enterprise' });

    expect(res.status).toBe(400);
    expect(env.subscriptions.all()).toHaveLength(0);
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('rejects a missing customer with no persistence and no provider call', async () => {
    const body = new SubscriptionRequestBuilder().build();
    const res = await env.apiClient.createSubscription({ ...body, customer_id: undefined });

    expect(res.status).toBe(400);
    expect(env.subscriptions.all()).toHaveLength(0);
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('rejects a missing payment method with no persistence and no provider call', async () => {
    const body = new SubscriptionRequestBuilder().build();
    const res = await env.apiClient.createSubscription({ ...body, payment_method_id: undefined });

    expect(res.status).toBe(400);
    expect(env.subscriptions.all()).toHaveLength(0);
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('rejects a malformed body (array) with no persistence and no provider call', async () => {
    const res = await env.apiClient.createSubscription([]);

    expect(res.status).toBe(400);
    expect(env.subscriptions.all()).toHaveLength(0);
    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('rejects double-cancel of an already-canceled subscription with 409', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const first = await env.apiClient.cancelSubscription(id);
    expect(first.status).toBe(200);

    const second = await env.apiClient.cancelSubscription(id);
    expect(second.status).toBe(409);
  });

  it('returns 404 for an unknown subscription GET', async () => {
    const res = await env.apiClient.getSubscription('sub_missing');
    expect(res.status).toBe(404);
  });

  it('returns 404 when canceling an unknown subscription', async () => {
    const res = await env.apiClient.cancelSubscription('sub_missing');
    expect(res.status).toBe(404);
  });
});