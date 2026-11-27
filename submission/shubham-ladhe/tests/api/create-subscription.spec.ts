import { expectOk } from '../framework/api/SubscriptionApiClient';
import { aSignupRequest, SignupRequestBuilder } from '../framework/builders';
import { daysAfterStart, PLANS, SEED, TEST_EPOCH } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';
import { expectError } from '../framework/verify/expectations';

describe('POST /subscriptions', () => {
  const env = useHarness();

  describe('success', () => {
    it('trial plan: 201, starts trialing, trial end per plan, nothing charged, stored row matches response', async () => {
      const response = await env().api.create(aSignupRequest().onBasicPlan().build());

      expect(response.status).toBe(201);
      const created = expectOk(response);
      expect(created).toMatchObject({
        customer_id: SEED.alice.customerId,
        payment_method_id: SEED.alice.card,
        plan: 'basic',
        status: 'trialing',
        amount: PLANS.basic.priceCents,
        currency: 'USD',
        current_period_start: TEST_EPOCH,
        trial_ends_at: daysAfterStart(PLANS.basic.trialDays),
        canceled_at: null,
        latest_invoice: null,
      });
      expect(env().gateway.calls).toHaveLength(0);
      expect(env().stored(created.id).mismatchesWith(created)).toEqual([]);
      expect(env().stored(created.id).auditActions()).toEqual(['created']);
    });

    it('no-trial plan: charged once at signup for the plan price and returned active', async () => {
      const response = await env().api.create(aSignupRequest().onProPlan().build());

      expect(response.status).toBe(201);
      const created = expectOk(response);
      expect(created).toMatchObject({
        plan: 'pro',
        status: 'active',
        amount: PLANS.pro.priceCents,
        latest_invoice: { status: 'paid', amount: PLANS.pro.priceCents },
      });
      expect(env().gateway.calls).toHaveLength(1);

      const stored = env().stored(created.id);
      expect(stored.mismatchesWith(created)).toEqual([]);
      expect(stored.attempts).toEqual([
        expect.objectContaining({ status: 'succeeded', amountCents: PLANS.pro.priceCents, attemptNo: 1 }),
      ]);
    });
  });

  describe('validation failures leave no trace: no rows, no audit, no provider call', () => {
    // Cases start from the charge-at-signup plan, so "the provider was not called" actually means something.
    const proSignup = (): SignupRequestBuilder => aSignupRequest().onProPlan();

    const cases: Array<{ name: string; request: SignupRequestBuilder | string; status: number; code: string }> = [
      { name: 'unknown plan', request: proSignup().onPlan('enterprise'), status: 422, code: 'unknown_plan' },
      { name: 'missing field', request: proSignup().without('payment_method_id'), status: 400, code: 'invalid_request' },
      { name: 'wrong field type', request: proSignup().with('customer_id', 42), status: 400, code: 'invalid_request' },
      { name: 'body is not JSON', request: '{"customer_id": "cust_001", ', status: 400, code: 'invalid_request' },
      { name: 'unknown customer', request: proSignup().forCustomer('cust_ghost'), status: 422, code: 'unknown_customer' },
      {
        name: "another customer's payment method",
        request: proSignup().forCustomer(SEED.alice.customerId).payingWith(SEED.bob.card),
        status: 422,
        code: 'invalid_payment_method',
      },
      {
        name: 'expired payment method',
        request: proSignup().forCustomer(SEED.bob.customerId, SEED.bob.expiredCard),
        status: 422,
        code: 'invalid_payment_method',
      },
    ];

    it.each(cases)('$name -> $status $code', async ({ request, status, code }) => {
      const dbBefore = env().snapshot();

      const response = await env().api.create(typeof request === 'string' ? request : request.build());

      expectError(response, status, code);
      expect(env().tablesChangedSince(dbBefore)).toEqual([]);
      expect(env().gateway.calls).toHaveLength(0);
    });
  });

  describe('client retries (Idempotency-Key)', () => {
    it('same key + same body: original response replayed, one subscription, one charge', async () => {
      const request = aSignupRequest().onProPlan().build();

      const original = await env().api.create(request, { idempotencyKey: 'signup-123' });
      const retry = await env().api.create(request, { idempotencyKey: 'signup-123' });

      expect(original.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(original.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(env().repos.subscriptions.findAll()).toHaveLength(1);
      expect(env().gateway.calls).toHaveLength(1);
    });

    it('same key + different body: 409 and nothing new is created', async () => {
      await env().api.createOk(aSignupRequest().onBasicPlan().build(), { idempotencyKey: 'signup-123' });
      const dbBefore = env().snapshot();

      const response = await env().api.create(aSignupRequest().onProPlan().build(), { idempotencyKey: 'signup-123' });

      expectError(response, 409, 'idempotency_key_reused');
      expect(env().tablesChangedSince(dbBefore)).toEqual([]);
      expect(env().gateway.calls).toHaveLength(0);
    });
  });
});
