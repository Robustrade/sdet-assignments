import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

/**
 * Basic plan = 0-day trial, so the first charge happens inside POST /subscriptions.
 * The subscription may only become `active` after the provider reports success.
 */
describe('POST /subscriptions - initial charge (basic plan)', () => {
  let env: TestEnvironment;

  const basicRequest = () =>
    aSubscriptionRequest()
      .forCustomer('cust_002')
      .onPlan('basic')
      .withPaymentMethod('pm_test_mastercard_5555')
      .build();

  /** What the provider must receive for the first basic subscription of this suite. */
  const expectedCharge = {
    customerId: 'cust_002',
    paymentMethodId: 'pm_test_mastercard_5555',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: 'initial:sub_001',
    reference: 'sub_001',
  };

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('provider approves the charge', () => {
    it('returns 201 with an active subscription', async () => {
      const res = await env.api.createSubscription(basicRequest());

      expect(res.status).toBe(201);
      BillingAssertions.expectSubscriptionShape(res.body);
      expect(res.body).toMatchObject({ id: 'sub_001', plan: 'basic', status: 'active', price: 1900, currency: 'USD' });
    });

    it('charges the provider exactly once with the plan price, customer, payment method and reference', async () => {
      await env.api.createSubscription(basicRequest());

      env.providerCalls.expectChargedOnce(expectedCharge);
    });

    it('persists the active subscription and the API agrees with the stored row', async () => {
      const res = await env.api.createSubscription(basicRequest());

      await env.persistence.expectSubscriptionCount(1);
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectSubscriptionMatchesApi(res.body);
      expect((await env.api.getSubscription('sub_001')).body).toEqual(res.body);
    });

    it('does not mark the subscription active before the provider has answered', async () => {
      let storedWhileCharging: unknown[] = [];
      env.provider.charge.mockImplementationOnce(async () => {
        storedWhileCharging = await env.subscriptions.list();
        return { status: 'succeeded', providerChargeId: 'ch_probe' };
      });

      await env.api.createSubscription(basicRequest());

      expect(storedWhileCharging).toEqual([]);
    });

    it('uses a different idempotency key and reference for every new subscription', async () => {
      await env.api.createSubscription(basicRequest());
      await env.api.createSubscription(basicRequest());

      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(0, expectedCharge);
      env.providerCalls.expectChargeAt(1, { ...expectedCharge, idempotencyKey: 'initial:sub_002', reference: 'sub_002' });
      env.providerCalls.expectDistinctIdempotencyKeys();
    });
  });

  describe('provider declines the charge', () => {
    beforeEach(() => {
      env.provider.willDecline('insufficient_funds');
    });

    it('returns 201 with a past_due subscription, never active', async () => {
      const res = await env.api.createSubscription(basicRequest());

      expect(res.status).toBe(201);
      BillingAssertions.expectSubscriptionShape(res.body);
      expect(res.body.status).toBe('past_due');
    });

    it('made exactly one charge attempt with the expected arguments', async () => {
      await env.api.createSubscription(basicRequest());

      env.providerCalls.expectChargedOnce(expectedCharge);
    });

    it('persists past_due, matching the API, and exposes the same state on GET', async () => {
      const res = await env.api.createSubscription(basicRequest());

      await env.persistence.expectSubscriptionCount(1);
      await env.persistence.expectStoredStatus('sub_001', 'past_due');
      await env.persistence.expectSubscriptionMatchesApi(res.body);
      expect((await env.api.getSubscription('sub_001')).body.status).toBe('past_due');
    });
  });

  describe('provider times out', () => {
    beforeEach(() => {
      env.provider.willTimeout();
    });

    it('answers 504 provider_timeout', async () => {
      const res = await env.api.createSubscription(basicRequest());

      BillingAssertions.expectError(res, 504, 'provider_timeout');
    });

    it('persists no subscription, because the payment outcome is unknown', async () => {
      await env.api.createSubscription(basicRequest());

      await env.persistence.expectNoSubscriptions();
      expect((await env.api.getSubscription('sub_001')).status).toBe(404);
    });

    it('made exactly one charge attempt with the expected arguments', async () => {
      await env.api.createSubscription(basicRequest());

      env.providerCalls.expectChargedOnce(expectedCharge);
    });
  });

  describe('pro plan (14-day trial) needs no charge at creation', () => {
    it('stays trialing and never calls the provider', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('trialing');
      env.providerCalls.expectNoCharges();
      await env.persistence.expectStoredStatus(res.body.id, 'trialing');
    });

    it('is unaffected by a provider that would decline or time out', async () => {
      env.provider.willDecline();
      const declined = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
      env.provider.willTimeout();
      const timedOut = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

      expect(declined.body.status).toBe('trialing');
      expect(timedOut.status).toBe(201);
      env.providerCalls.expectNoCharges();
    });
  });
});
