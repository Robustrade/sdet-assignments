import { describe, it, expect, beforeEach } from 'vitest';
import { createTestEnvironment } from '../framework/TestEnvironment.js';
import type { TestEnvironment } from '../framework/contracts.js';
import { SubscriptionRequestBuilder } from '../builders/SubscriptionRequestBuilder.js';
import { SubscriptionAssertions } from '../framework/assertions/SubscriptionAssertions.js';
import { ProviderAssertions } from '../framework/assertions/ProviderAssertions.js';
import { PRO_PLAN, BASIC_PLAN } from '../data/plans.fixture.js';

describe('POST /subscriptions — creation', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  it('creates a subscription that starts in trialing for a plan with a trial period', async () => {
    const body = new SubscriptionRequestBuilder().onPlan('basic').build();
    const res = await env.apiClient.createSubscription(body);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('trialing');
    expect(res.body.plan).toBe('basic');
    expect(res.body.customer_id).toBe('cust_001');
    expect(res.body.payment_method_id).toBe('pm_test_visa_4242');
    expect(typeof res.body.id).toBe('string');

    const persisted = env.subscriptions.findById(res.body.id as string);
    SubscriptionAssertions.expectState(persisted, 'trialing');
    SubscriptionAssertions.expectPlan(persisted, 'basic');

    ProviderAssertions.expectNeverCalled(env.provider);
  });

  it('charges immediately and creates an active subscription for a no-trial plan', async () => {
    env.provider.willSucceed();
    const body = new SubscriptionRequestBuilder().onPlan('pro').build();
    const res = await env.apiClient.createSubscription(body);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');

    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, {
      customerId: 'cust_001',
      amount: PRO_PLAN.price,
      currency: PRO_PLAN.currency,
      paymentMethodId: 'pm_test_visa_4242',
    });
  });

  it('creates a past_due subscription when the immediate charge is declined', async () => {
    env.provider.willDecline();
    const body = new SubscriptionRequestBuilder().onPlan('pro').build();
    const res = await env.apiClient.createSubscription(body);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, {
      amount: PRO_PLAN.price,
    });
  });

  it('creates a past_due subscription when the immediate charge times out', async () => {
    env.provider.willTimeout();
    const body = new SubscriptionRequestBuilder().onPlan('pro').build();
    const res = await env.apiClient.createSubscription(body);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    ProviderAssertions.expectChargedExactlyOnceWith(env.provider, {
      amount: PRO_PLAN.price,
    });
  });

  it('applies plan-specific price and trial rules (basic vs pro differ)', () => {
    expect(BASIC_PLAN.price).not.toBe(PRO_PLAN.price);
    expect(BASIC_PLAN.trialDays).toBeGreaterThan(0);
    expect(PRO_PLAN.trialDays).toBe(0);
  });

  it('GET returns the persisted subscription matching creation', async () => {
    const body = new SubscriptionRequestBuilder().onPlan('basic').build();
    const created = await env.apiClient.createSubscription(body);
    const id = created.body.id as string;

    const res = await env.apiClient.getSubscription(id);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe('trialing');
    expect(res.body.plan).toBe('basic');
    expect(res.body.customer_id).toBe('cust_001');
  });

  it('cancels an active subscription', async () => {
    env.provider.willSucceed();
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('pro').build(),
    );
    const id = created.body.id as string;

    const res = await env.apiClient.cancelSubscription(id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');

    const persisted = env.subscriptions.findById(id);
    SubscriptionAssertions.expectState(persisted, 'canceled');
  });

  it('cancels a trialing subscription', async () => {
    const created = await env.apiClient.createSubscription(
      new SubscriptionRequestBuilder().onPlan('basic').build(),
    );
    const id = created.body.id as string;

    const res = await env.apiClient.cancelSubscription(id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
    SubscriptionAssertions.expectState(env.subscriptions.findById(id), 'canceled');
  });
});