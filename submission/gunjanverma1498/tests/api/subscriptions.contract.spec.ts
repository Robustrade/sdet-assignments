import { beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../support/builders/SubscriptionRequestBuilder';
import { TestEnvironment } from '../support/fixtures/TestEnvironment';
import { verify } from '../support/assertions';

describe('API contract: /subscriptions', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.setup();
  });

  describe('creation', () => {
    it('creates a trial-plan subscription in `trialing` without charging', async () => {
      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
      );

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        customer_id: 'cust_001',
        plan: 'pro',
        payment_method_id: 'pm_test_visa_4242',
        status: 'trialing',
        failed_charge_count: 0,
      });
      expect(res.body.id).toMatch(/^sub_/);
      expect(res.body.trial_end_at).not.toBeNull();
      verify(env).provider.wasNotCharged();
    });

    it('creates an immediate-charge subscription as `active` after a successful charge', async () => {
      env.provider.willReturn('success');

      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPlan('basic').build(),
      );

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');
      expect(res.body.trial_end_at).toBeNull();
      verify(env).provider.chargedExactlyOnce();
    });
  });

  describe('retrieval', () => {
    it('returns a persisted subscription', async () => {
      const created = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().build(),
      );

      const res = await env.api.getSubscription(created.body.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.status).toBe('trialing');
    });

    it('returns 404 for an unknown subscription', async () => {
      const res = await env.api.getSubscription('sub_does_not_exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('subscription_not_found');
    });
  });

  describe('cancellation', () => {
    it('cancels a trialing subscription', async () => {
      const created = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
      );

      const res = await env.api.cancelSubscription(created.body.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('canceled');
      verify(env).provider.wasNotCharged();
    });

    it('returns 409 when cancelling an already-canceled subscription', async () => {
      const created = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPlan('pro').build(),
      );
      await env.api.cancelSubscription(created.body.id);

      const res = await env.api.cancelSubscription(created.body.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('already_canceled');
    });

    it('returns 404 when cancelling an unknown subscription', async () => {
      const res = await env.api.cancelSubscription('sub_nope');
      expect(res.status).toBe(404);
    });
  });

  describe('validation failures', () => {
    it('rejects a missing plan (400)', async () => {
      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withoutPlan().build(),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      verify(env).provider.wasNotCharged();
    });

    it('rejects an unknown plan (400)', async () => {
      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPlan('enterprise').build(),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('unknown_plan');
      verify(env).provider.wasNotCharged();
    });

    it('rejects an unknown customer (404)', async () => {
      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().forCustomer('cust_ghost').build(),
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('customer_not_found');
      verify(env).provider.wasNotCharged();
    });

    it('rejects a payment method not on file (400)', async () => {
      const res = await env.api.createSubscription(
        SubscriptionRequestBuilder.aSubscription().withPaymentMethod('pm_unknown').build(),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_payment_method');
      verify(env).provider.wasNotCharged();
    });
  });
});
