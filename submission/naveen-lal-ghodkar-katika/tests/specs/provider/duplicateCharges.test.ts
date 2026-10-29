import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

/**
 * Repeated operations must not charge twice. Retrying a creation is made safe by the
 * caller-supplied `Idempotency-Key` header; reads and cancels never charge at all.
 */
describe('repeated operations never create duplicate charges', () => {
  let env: TestEnvironment;

  const basicRequest = () => aSubscriptionRequest().forCustomer('cust_002').onPlan('basic').build();

  const expectedCharge = {
    customerId: 'cust_002',
    paymentMethodId: 'pm_test_visa_4242',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: 'initial:sub_001',
    reference: 'sub_001',
  };

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('replaying a creation with the same Idempotency-Key', () => {
    it('returns the original subscription and does not charge again', async () => {
      const first = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      const replay = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      env.providerCalls.expectChargedOnce(expectedCharge);
      await env.persistence.expectSubscriptionCount(1);
    });

    it('stays a no-op however many times it is replayed', async () => {
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      for (let i = 0; i < 5; i += 1) {
        await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      }

      env.providerCalls.expectCallCount(1);
      await env.persistence.expectSubscriptionCount(1);
    });

    it('also replays a declined creation without a second charge attempt', async () => {
      env.provider.willDecline();

      const first = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      env.provider.willSucceed(); // a second attempt, if it happened, would flip the result
      const replay = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      expect(first.body.status).toBe('past_due');
      expect(replay.body).toEqual(first.body);
      env.providerCalls.expectCallCount(1);
    });

    it('reports the current state of the subscription, still without charging', async () => {
      const first = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      await env.api.cancelSubscription(first.body.id);

      const replay = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe('canceled');
      env.providerCalls.expectCallCount(1);
    });
  });

  describe('different Idempotency-Keys are different requests', () => {
    it('charge once each, with different provider idempotency keys', async () => {
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-1' });
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-2' });

      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectDistinctIdempotencyKeys();
      await env.persistence.expectSubscriptionCount(2);
    });
  });

  describe('reusing an Idempotency-Key for a different request', () => {
    it.each([
      ['another plan', () => aSubscriptionRequest().forCustomer('cust_002').onPlan('pro').build()],
      ['another customer', () => aSubscriptionRequest().forCustomer('cust_001').onPlan('basic').build()],
      [
        'another payment method',
        () => aSubscriptionRequest().forCustomer('cust_002').onPlan('basic').withPaymentMethod('pm_other').build(),
      ],
    ])('is rejected with 409 idempotency_conflict (%s) and charges nothing', async (_name, payload) => {
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      const conflicting = await env.api.createSubscription(payload(), { idempotencyKey: 'order-42' });

      BillingAssertions.expectError(conflicting, 409, 'idempotency_conflict');
      env.providerCalls.expectCallCount(1);
      await env.persistence.expectSubscriptionCount(1);
    });
  });

  describe('retrying after a provider timeout', () => {
    it('reuses the same subscription id, idempotency key and arguments, so the provider can deduplicate', async () => {
      env.provider.timeoutOnce();

      const first = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      const retry = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      BillingAssertions.expectError(first, 504, 'provider_timeout');
      expect(retry.status).toBe(201);
      expect(retry.body).toMatchObject({ id: 'sub_001', status: 'active' });
      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(0, expectedCharge);
      env.providerCalls.expectChargeAt(1, expectedCharge);
      await env.persistence.expectSubscriptionCount(1);
    });

    it('does not charge again once the retry has succeeded and is replayed', async () => {
      env.provider.timeoutOnce();
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      const replay = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      expect(replay.status).toBe(200);
      env.providerCalls.expectCallCount(2);
    });

    it('can end in a decline: the retry is charged with the same key and the result is past_due', async () => {
      env.provider.timeoutOnce().declineOnce();

      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });
      const retry = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'order-42' });

      expect(retry.body).toMatchObject({ id: 'sub_001', status: 'past_due' });
      env.providerCalls.expectChargeAt(1, expectedCharge);
    });

    // Documented limitation: without the header the service cannot tell a retry from a new request.
    it('WITHOUT an Idempotency-Key a retry is a brand-new attempt with a new key (known limitation)', async () => {
      env.provider.timeoutOnce();

      await env.api.createSubscription(basicRequest());
      await env.api.createSubscription(basicRequest());

      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(1, {
        ...expectedCharge,
        idempotencyKey: 'initial:sub_002',
        reference: 'sub_002',
      });
      env.providerCalls.expectDistinctIdempotencyKeys();
    });
  });

  describe('operations that never need a charge', () => {
    it('repeated GET and repeated cancel leave the provider call count at the original 1', async () => {
      const created = await env.api.createSubscription(basicRequest());

      await env.api.getSubscription(created.body.id);
      await env.api.getSubscription(created.body.id);
      await env.api.cancelSubscription(created.body.id);
      const secondCancel = await env.api.cancelSubscription(created.body.id);

      expect(secondCancel.status).toBe(409);
      env.providerCalls.expectChargedOnce(expectedCharge);
    });

    it('a pro creation replayed with the same key never reaches the provider', async () => {
      const proRequest = aSubscriptionRequest().onPlan('pro').build();

      await env.api.createSubscription(proRequest, { idempotencyKey: 'order-7' });
      const replay = await env.api.createSubscription(proRequest, { idempotencyKey: 'order-7' });

      expect(replay.status).toBe(200);
      env.providerCalls.expectNoCharges();
      await env.persistence.expectSubscriptionCount(1);
    });
  });
});
