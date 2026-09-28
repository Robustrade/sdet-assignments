import { TestEnvironment } from '../../support/TestEnvironment';
import { aCustomer } from '../../support/builders/CustomerBuilder';
import { aSubscriptionRequest } from '../../support/builders/SubscriptionRequestBuilder';

describe('Subscriptions API - contract & validation', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => env.assertCleanTeardown());

  const ISO = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

  describe('POST /subscriptions', () => {
    it('basic plan: 201, starts trialing with a 14-day trial, no charge, persisted row matches response', async () => {
      const customer = env.given.customer();
      const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^sub_/),
        customer_id: customer.id,
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
        status: 'trialing',
        trial_ends_at: '2026-01-15T00:00:00.000Z',
        current_period_end: null,
        canceled_at: null,
        created_at: ISO,
        updated_at: ISO,
        latest_invoice: null,
      });
      expect(env.provider.callCount).toBe(0);
      expect(env.repos.invoices.findBySubscription(res.body.id)).toHaveLength(0);
      await env.verify.expectSubscriptionIn(res.body.id, 'trialing');
    });

    it('pro plan (0-day trial): charged immediately, 201 active with a paid invoice of 4900 USD', async () => {
      env.provider.willSucceed();
      const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer(env.given.customer()).onPlan('pro').build());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');
      expect(res.body.latest_invoice).toEqual({ id: expect.any(String), amount: 4900, currency: 'USD', status: 'paid' });
      expect(res.body.current_period_end).toBe('2026-01-31T00:00:00.000Z');
      await env.verify.expectSubscriptionIn(res.body.id, 'active');
    });
  });

  describe('validation failures -> correct error AND no persistence AND no provider call', () => {
    const expectNothingPersisted = () => {
      expect(env.repos.subscriptions.all()).toHaveLength(0);
      expect(env.repos.invoices.all()).toHaveLength(0);
      expect(env.repos.payments.all()).toHaveLength(0);
      expect(env.provider.callCount).toBe(0);
    };

    it.each(['customer_id', 'plan', 'payment_method_id'])('missing %s -> 400 validation_error', async (field) => {
      env.given.customer(aCustomer().withId('cust_001'));
      const res = await env.api.createSubscription(aSubscriptionRequest().without(field).build());
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'validation_error', details: { fields: [field] } });
      expectNothingPersisted();
    });

    it.each([
      ['number plan', 'plan', 42],
      ['empty customer', 'customer_id', ''],
      ['null payment method', 'payment_method_id', null],
    ])('wrong type (%s) -> 400', async (_label, field, value) => {
      const res = await env.api.createSubscription(aSubscriptionRequest().with(field, value).build());
      expect(res.status).toBe(400);
      expectNothingPersisted();
    });

    it('malformed JSON body -> 400', async () => {
      const res = await env.api.createSubscriptionRaw('{"plan": "pro",');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      expectNothingPersisted();
    });

    it('unknown plan -> 422 unknown_plan', async () => {
      const c = env.given.customer();
      const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer(c).onPlan('platinum').build());
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unknown_plan');
      expectNothingPersisted();
    });

    it('unknown customer -> 422 unknown_customer', async () => {
      const res = await env.api.createSubscription(aSubscriptionRequest().withCustomerId('cust_ghost').onPlan('pro').build());
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unknown_customer');
      expectNothingPersisted();
    });

    it("payment method that isn't the customer's -> 422 invalid_payment_method (pro plan: no charge attempted)", async () => {
      const c = env.given.customer();
      const res = await env.api.createSubscription(
        aSubscriptionRequest().forCustomer(c).onPlan('pro').withPaymentMethod('pm_someone_else').build(),
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('invalid_payment_method');
      expectNothingPersisted();
    });
  });

  describe('GET /subscriptions/:id', () => {
    it('returns the same representation as creation', async () => {
      const created = await env.given.trialingSubscription();
      const res = await env.api.getSubscription(created.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created);
    });

    it('unknown id -> 404 not_found', async () => {
      const res = await env.api.getSubscription('sub_nope');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('POST /subscriptions/:id/cancel', () => {
    it('canceling an already-canceled subscription -> 409, nothing new persisted', async () => {
      const sub = await env.given.canceledSubscription();
      const before = env.verify.snapshot(sub.id);

      const res = await env.api.cancelSubscription(sub.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('invalid_transition');
      expect(env.verify.snapshot(sub.id)).toEqual(before);
      expect(env.notifier.for(sub.id).filter((n) => n.kind === 'subscription.canceled')).toHaveLength(1);
    });

    it('unknown id -> 404', async () => {
      expect((await env.api.cancelSubscription('sub_nope')).status).toBe(404);
    });
  });
});
