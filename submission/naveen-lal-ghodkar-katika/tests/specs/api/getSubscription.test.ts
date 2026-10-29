import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

describe('GET /subscriptions/{id}', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it('returns 200 with exactly the representation returned at creation', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

    const fetched = await env.api.getSubscription(created.body.id);

    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
    BillingAssertions.expectSubscriptionShape(fetched.body);
  });

  it('returns the matching subscription when several exist', async () => {
    const pro = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    const basic = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());

    const fetchedBasic = await env.api.getSubscription(basic.body.id);
    const fetchedPro = await env.api.getSubscription(pro.body.id);

    expect(fetchedBasic.body.plan).toBe('basic');
    expect(fetchedPro.body.plan).toBe('pro');
  });

  it('returns 404 subscription_not_found for an unknown id', async () => {
    const res = await env.api.getSubscription('sub_does_not_exist');

    BillingAssertions.expectError(res, 404, 'subscription_not_found');
  });

  it('does not create anything when reading', async () => {
    await env.api.getSubscription('sub_does_not_exist');

    await env.persistence.expectNoSubscriptions();
  });
});
