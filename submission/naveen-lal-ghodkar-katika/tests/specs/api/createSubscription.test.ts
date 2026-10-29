import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

describe('POST /subscriptions - creation', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('pro plan (14-day trial, 4900 USD cents)', () => {
    it('returns 201 with the documented payload shape', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

      expect(res.status).toBe(201);
      BillingAssertions.expectSubscriptionShape(res.body);
    });

    it('starts in trialing with plan price, currency and trial end applied', async () => {
      const res = await env.api.createSubscription(
        aSubscriptionRequest().forCustomer('cust_002').onPlan('pro').build(),
      );

      expect(res.body).toEqual({
        id: 'sub_001',
        customer_id: 'cust_002',
        plan: 'pro',
        status: 'trialing',
        price: 4900,
        currency: 'USD',
        created_at: '2026-01-01T00:00:00.000Z',
        trial_ends_at: '2026-01-15T00:00:00.000Z',
      });
    });

    it('persists exactly one subscription that matches the API response', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

      await env.persistence.expectSubscriptionCount(1);
      await env.persistence.expectSubscriptionMatchesApi(res.body);
    });
  });

  describe('basic plan (0-day trial, 1900 USD cents)', () => {
    it('applies the basic price and a trial that ends at creation time', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        plan: 'basic',
        price: 1900,
        currency: 'USD',
        created_at: '2026-01-01T00:00:00.000Z',
        trial_ends_at: '2026-01-01T00:00:00.000Z',
      });
      await env.persistence.expectSubscriptionMatchesApi(res.body);
    });

    // The immediate charge (-> active / past_due / 504) is covered in specs/provider/initialCharge.test.ts.
  });

  it('generates a distinct id for each subscription', async () => {
    const first = await env.api.createSubscription(aSubscriptionRequest().build());
    const second = await env.api.createSubscription(aSubscriptionRequest().build());

    expect(first.body.id).not.toEqual(second.body.id);
    await env.persistence.expectSubscriptionCount(2);
  });
});
