import { test, expect } from './fixtures';
import { aSubscriptionRequest } from './helpers/builders';

test.describe('API: create, get, cancel', () => {
  test('basic plan starts in trialing with a 14-day trial and is NOT charged', async ({ api, given, paymentProvider, db }) => {
    const customer = given.newCustomer();
    const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^sub_/),
      customer_id: customer.id,
      plan: 'basic',
      status: 'trialing',
      payment_method_id: 'pm_visa_4242',
      trial_ends_at: '2026-01-15T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      canceled_at: null,
    });
    expect(paymentProvider.calls).toHaveLength(0);
    expect(db.getSubscription(res.body.id)?.status).toBe('trialing'); // database agrees with API
  });

  test('pro plan (no trial) is charged at signup and becomes active', async ({ api, given, paymentProvider, db }) => {
    const customer = given.newCustomer();
    const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(paymentProvider.calls).toHaveLength(1);
    expect(db.invoicesOf(res.body.id).map((i) => i.status)).toEqual(['paid']);
  });

  test('GET returns the same subscription; unknown id returns 404', async ({ api, given }) => {
    const { sub } = await given.trialingBasic();
    expect((await api.getSubscription(sub.id)).body).toEqual(sub);
    expect((await api.getSubscription('sub_nope')).status).toBe(404);
  });

  for (const field of ['customer_id', 'plan', 'payment_method_id']) {
    test(`missing ${field} -> 400, nothing saved, nothing charged`, async ({ api, given, db, paymentProvider }) => {
      const customer = given.newCustomer();
      const res = await api.createSubscription(aSubscriptionRequest().forCustomer(customer).without(field).build());

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'missing_field', message: field });
      expect(db.allSubscriptions()).toHaveLength(0);
      expect(paymentProvider.calls).toHaveLength(0);
    });
  }

  const invalidCases = [
    { name: 'unknown plan', change: { plan: 'enterprise' }, error: 'unknown_plan' },
    { name: 'unknown customer', change: { customer_id: 'cust_ghost' }, error: 'unknown_customer' },
    { name: "payment method not owned by the customer", change: { payment_method_id: 'pm_someone_else' }, error: 'invalid_payment_method' },
  ];
  for (const c of invalidCases) {
    test(`${c.name} -> 422, nothing saved, nothing charged`, async ({ api, given, db, paymentProvider }) => {
      const customer = given.newCustomer();
      const body = { ...aSubscriptionRequest().forCustomer(customer).onPlan('pro').build(), ...c.change };
      const res = await api.createSubscription(body);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe(c.error);
      expect(db.allSubscriptions()).toHaveLength(0);
      expect(paymentProvider.calls).toHaveLength(0);
    });
  }

  test('broken JSON -> 400', async ({ api }) => {
    const res = await api.createSubscriptionRaw('{"plan": "pro",');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('malformed_json');
  });

  test('cancel works and sets canceled_at', async ({ api, given, clock }) => {
    const { sub } = await given.activePro();
    clock.advanceDays(3);
    const res = await api.cancel(sub.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
    expect(res.body.canceled_at).toBe('2026-01-04T00:00:00.000Z');
  });

  test('cancel an already-canceled subscription -> 409 and no new side effects', async ({ api, given, db }) => {
    const { sub } = await given.canceled();
    const auditBefore = db.auditOf(sub.id).length;
    const emailsBefore = db.outboxOf(sub.id).length;

    const res = await api.cancel(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('invalid_transition');
    expect(db.auditOf(sub.id)).toHaveLength(auditBefore);
    expect(db.outboxOf(sub.id)).toHaveLength(emailsBefore);
  });
});
