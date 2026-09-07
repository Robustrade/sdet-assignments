import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { CustomerBuilder } from '../../src/testUtils/builders/customerBuilder';

describe('Subscription API', () => {
  describe('creation', () => {
    it('creates a trial-plan subscription in trialing state, no charge made', async () => {
      const { api, provider } = createTestContext();
      const body = new SubscriptionRequestBuilder().withPlan('pro').build();

      const res = await api.createSubscription(body);

      expect(res.status).toBe(201);
      expect(res.body.state).toBe('trialing');
      expect(res.body.plan).toBe('pro');
      expect(provider.callCount()).toBe(0);
    });

    it('response payload shape matches the persisted subscription fields', async () => {
      const { api } = createTestContext();
      const res = await api.createSubscription(new SubscriptionRequestBuilder().build());

      expect(res.body).toMatchObject({
        id: expect.stringMatching(/^sub_/),
        customerId: expect.any(String),
        plan: expect.any(String),
        state: expect.any(String),
        trialEndsAt: expect.any(String),
        canceledAt: null,
        failedChargeCount: 0,
      });
    });

    it('applies plan-specific trial length: pro gets a 14-day trial, basic a 7-day trial', async () => {
      const { api } = createTestContext();
      const pro = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
      const basic = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

      const daysBetween = (start: string, end: string) => (new Date(end).getTime() - new Date(start).getTime()) / 86400000;

      expect(daysBetween(pro.body.createdAt, pro.body.trialEndsAt)).toBeCloseTo(14, 1);
      expect(daysBetween(basic.body.createdAt, basic.body.trialEndsAt)).toBeCloseTo(7, 1);
    });
  });

  describe('validation failures', () => {
    it('rejects an unknown plan, and never touches the payment provider or persists anything', async () => {
      const { api, provider, store } = createTestContext();
      const res = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('enterprise-ultra').build());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unknown plan/);
      expect(provider.callCount()).toBe(0);
      expect(store.subscriptions.all()).toHaveLength(0);
    });

    it('rejects a missing payment method, and never touches the payment provider or persists anything', async () => {
      const { api, provider, store } = createTestContext();
      const res = await api.createSubscription(new SubscriptionRequestBuilder().withoutPaymentMethod().build());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/payment_method_id/);
      expect(provider.callCount()).toBe(0);
      expect(store.subscriptions.all()).toHaveLength(0);
    });

    it('rejects a missing customer id, and never touches the payment provider or persists anything', async () => {
      const { api, provider, store } = createTestContext();
      const res = await api.createSubscription(new SubscriptionRequestBuilder().withoutCustomerId().build());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/customer_id/);
      expect(provider.callCount()).toBe(0);
      expect(store.subscriptions.all()).toHaveLength(0);
    });

    it('rejects an unknown/unregistered customer_id, and never touches the payment provider or persists anything', async () => {
      const { api, provider, store } = createTestContext();
      const res = await api.createSubscription(new SubscriptionRequestBuilder().forCustomer('cust_never_registered').build());

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unknown customer/);
      expect(provider.callCount()).toBe(0);
      expect(store.subscriptions.all()).toHaveLength(0);
    });

    it('accepts creation for a newly registered customer built via CustomerBuilder', async () => {
      const { api, store } = createTestContext();
      const newCustomer = new CustomerBuilder().build();
      store.customers.save(newCustomer);

      const res = await api.createSubscription(
        new SubscriptionRequestBuilder().forCustomer(newCustomer.id).withPaymentMethod(newCustomer.paymentMethodId).build(),
      );

      expect(res.status).toBe(201);
      expect(res.body.customerId).toBe(newCustomer.id);
    });

    it('rejects a body that is not valid JSON with a consistent JSON error', async () => {
      const { api } = createTestContext();
      const res = await api.postRawSubscriptionBody('{ not valid json');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('malformed_json');
    });
  });

  describe('retrieval', () => {
    it('retrieves a created subscription by id', async () => {
      const { api } = createTestContext();
      const created = await api.createSubscription(new SubscriptionRequestBuilder().build());

      const res = await api.getSubscription(created.body.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it('returns 404 for an unknown subscription id', async () => {
      const { api } = createTestContext();
      const res = await api.getSubscription('sub_does_not_exist');
      expect(res.status).toBe(404);
    });
  });

  describe('cancellation', () => {
    it('cancels a subscription via the API', async () => {
      const { api } = createTestContext();
      const created = await api.createSubscription(new SubscriptionRequestBuilder().build());

      const res = await api.cancelSubscription(created.body.id);

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('canceled');
    });

    it('canceling an already-canceled subscription is a no-op, not an error', async () => {
      const { api } = createTestContext();
      const created = await api.createSubscription(new SubscriptionRequestBuilder().build());
      await api.cancelSubscription(created.body.id);

      const res = await api.cancelSubscription(created.body.id);

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('canceled');
    });

    it('returns 404 canceling an unknown subscription', async () => {
      const { api } = createTestContext();
      const res = await api.cancelSubscription('sub_nope');
      expect(res.status).toBe(404);
    });
  });
});
