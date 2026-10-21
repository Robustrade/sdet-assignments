const { test, expect } = require('../helpers/fixtures');
const { aSubscription } = require('../helpers/builders');

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe('API contract: create & get subscription', () => {
  test('basic plan is created in trialing with a 14-day trial and no charge', async ({ api, verify }) => {
    const res = await api.createSubscription(aSubscription().onPlan('basic').build());

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      id: expect.stringMatching(/^sub_/),
      customer_id: 'cust_001',
      plan: 'basic',
      payment_method_id: 'pm_test_visa_4242',
      status: 'trialing',
      price: 1900,
      currency: 'USD',
      trial_ends_at: expect.any(String),
      created_at: expect.any(String),
      updated_at: expect.any(String),
      canceled_at: null,
    });
    expect(Date.parse(body.trial_ends_at) - Date.parse(body.created_at)).toBe(14 * DAY_MS);

    await verify.subscriptionIs(body.id, 'trialing');
    verify.invoiceStatuses(body.id, []);
    verify.auditTrail(body.id, ['trialing']);
    verify.providerNotCalled();
  });

  test('GET returns 404 for an unknown subscription', async ({ api }) => {
    const res = await api.getSubscription('sub_does_not_exist');

    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'SUBSCRIPTION_NOT_FOUND' });
  });
});

test.describe('API contract: validation failures', () => {
  // The pro plan charges immediately, so if validation were skipped the
  // provider WOULD be called - which makes "provider not called" meaningful.
  const invalidRequests = [
    { name: 'unknown plan', body: aSubscription().onPlan('enterprise').build(), status: 400, error: 'UNKNOWN_PLAN' },
    { name: 'missing customer_id', body: aSubscription().onPlan('pro').without('customer_id').build(), status: 400, error: 'VALIDATION_ERROR' },
    { name: 'missing plan', body: aSubscription().without('plan').build(), status: 400, error: 'VALIDATION_ERROR' },
    { name: 'missing payment_method_id', body: aSubscription().onPlan('pro').without('payment_method_id').build(), status: 400, error: 'VALIDATION_ERROR' },
    { name: 'invalid payment method', body: aSubscription().onPlan('pro').withPaymentMethod('visa_4242').build(), status: 400, error: 'INVALID_PAYMENT_METHOD' },
    { name: 'unknown customer', body: aSubscription().onPlan('pro').forCustomer('cust_999').build(), status: 404, error: 'CUSTOMER_NOT_FOUND' },
  ];

  for (const { name, body, status, error } of invalidRequests) {
    test(`rejects ${name} without storing anything or charging`, async ({ api, verify }) => {
      const res = await api.createSubscription(body);

      expect(res.status()).toBe(status);
      expect(await res.json()).toMatchObject({ error });
      verify.noSubscriptionsStored();
      verify.providerNotCalled();
    });
  }

  test('rejects a malformed JSON body', async ({ api, verify }) => {
    const res = await api.createSubscriptionWithRawBody('{"plan": "pro", ');

    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'MALFORMED_JSON' });
    verify.noSubscriptionsStored();
    verify.providerNotCalled();
  });
});

test.describe('API contract: cancel', () => {
  test('returns 404 when canceling an unknown subscription', async ({ api }) => {
    const res = await api.cancelSubscription('sub_does_not_exist');

    expect(res.status()).toBe(404);
  });

  test('returns 409 when canceling an already-canceled subscription and changes nothing', async ({ api, given, db, verify }) => {
    const sub = await given.canceledSubscription();
    const before = db.findSubscription(sub.id);

    const res = await api.cancelSubscription(sub.id);

    expect(res.status()).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'INVALID_TRANSITION' });
    expect(db.findSubscription(sub.id)).toEqual(before);
    verify.auditTrail(sub.id, ['trialing', 'canceled']);
  });
});
