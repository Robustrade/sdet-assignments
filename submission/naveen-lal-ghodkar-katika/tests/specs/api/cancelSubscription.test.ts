import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

describe('POST /subscriptions/{id}/cancel', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it('cancels a trialing subscription: 200, status canceled, other fields unchanged', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

    const res = await env.api.cancelSubscription(created.body.id);

    expect(res.status).toBe(200);
    BillingAssertions.expectSubscriptionShape(res.body);
    expect(res.body).toEqual({ ...created.body, status: 'canceled' });
  });

  it('persists the cancellation and the API agrees with the stored row', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().build());

    const cancelled = await env.api.cancelSubscription(created.body.id);
    const fetched = await env.api.getSubscription(created.body.id);

    expect(fetched.body.status).toBe('canceled');
    await env.persistence.expectSubscriptionMatchesApi(cancelled.body);
    await env.persistence.expectSubscriptionCount(1);
  });

  it('rejects cancelling an already-canceled subscription with 409 invalid_transition', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().build());
    await env.api.cancelSubscription(created.body.id);

    const second = await env.api.cancelSubscription(created.body.id);

    BillingAssertions.expectError(second, 409, 'invalid_transition');
    const fetched = await env.api.getSubscription(created.body.id);
    expect(fetched.body.status).toBe('canceled');
  });

  it('returns 404 subscription_not_found for an unknown id and persists nothing', async () => {
    const res = await env.api.cancelSubscription('sub_does_not_exist');

    BillingAssertions.expectError(res, 404, 'subscription_not_found');
    await env.persistence.expectNoSubscriptions();
  });

  it('only affects the targeted subscription', async () => {
    const target = await env.api.createSubscription(aSubscriptionRequest().build());
    const bystander = await env.api.createSubscription(aSubscriptionRequest().build());

    await env.api.cancelSubscription(target.body.id);

    const fetched = await env.api.getSubscription(bystander.body.id);
    expect(fetched.body.status).toBe('trialing');
  });
});
