import { aCustomer } from '../support/builders/customer-builder';
import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { expectApiMatchesDb, expectedChargeRequest, expectNoDatabaseChanges } from '../support/assertions/expectations';
import { START_TIME, useTestEnvironment } from '../support/fixtures/test-environment';

describe('POST /subscriptions', () => {
  const env = useTestEnvironment();

  test('API-01 trial plan: 201 trialing, 7-day trial, audit row, no invoice and no provider call', async () => {
    const res = await env.api.create(aSubscriptionRequest().onPlan('pro').build());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      customer_id: 'cust_001',
      plan: 'pro',
      status: 'trialing',
      trial_end: '2026-01-08T09:00:00.000Z',
      current_period_end: null,
      created_at: START_TIME,
      canceled_at: null,
    });
    await expectApiMatchesDb(env, res.body.id);
    expect(env.auditTrail(res.body.id)).toEqual(['none->trialing']);
    expect(env.invoicesOf(res.body.id)).toHaveLength(0);
    expect(env.provider.callCount).toBe(0);
  });

  test('API-02 immediate plan, provider success: 201 active, invoice paid, one exact provider call', async () => {
    env.provider.willSucceed();
    const res = await env.api.create(aSubscriptionRequest().onPlan('basic').build());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    const sub = await expectApiMatchesDb(env, res.body.id);
    const [invoice] = env.invoicesOf(sub.id);
    expect(invoice).toMatchObject({ status: 'paid', amountMinor: 1900, currency: 'USD' });
    expect(sub.currentPeriodEnd).toBe(invoice.periodEnd);
    expect(env.paymentsOf(sub.id)).toEqual([
      expect.objectContaining({ attemptNumber: 1, status: 'succeeded', providerReference: 'pr_0001' }),
    ]);
    expect(env.provider.calls).toEqual([expectedChargeRequest(sub, invoice, 1)]);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->active']);
  });

  test('API-03 immediate plan, provider decline: 201 past_due, failed attempt, no success record', async () => {
    env.provider.willDecline('insufficient_funds');
    const res = await env.api.create(aSubscriptionRequest().onPlan('basic').build());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    await expectApiMatchesDb(env, res.body.id);
    expect(env.latestInvoiceOf(res.body.id).status).toBe('open');
    expect(env.paymentsOf(res.body.id)).toEqual([
      expect.objectContaining({ status: 'failed', failureCode: 'insufficient_funds' }),
    ]);
    expect(env.provider.callCount).toBe(1);
  });

  describe('API-04 missing required fields -> 400 with no side effects', () => {
    test.each(['customer_id', 'plan', 'payment_method_id'] as const)('missing %s', async (field) => {
      const before = env.repos.snapshots.snapshot();
      const res = await env.api.create(aSubscriptionRequest().onPlan('basic').without(field).build());

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field, message: `${field} is required` }],
      });
      expectNoDatabaseChanges(env, before);
      expect(env.provider.callCount).toBe(0);
    });

    test('wrong field type', async () => {
      const res = await env.api.create(aSubscriptionRequest().with('plan', 42).build());
      expect(res.status).toBe(400);
      expect(res.body.error?.details).toEqual([{ field: 'plan', message: 'plan must be a string' }]);
    });

    test('malformed JSON body', async () => {
      const before = env.repos.snapshots.snapshot();
      const res = await env.api.createRaw('{"customer_id": "cust_001",');
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
      expectNoDatabaseChanges(env, before);
    });
  });

  test('API-05 unknown customer -> 404, nothing persisted, no provider call', async () => {
    const before = env.repos.snapshots.snapshot();
    const res = await env.api.create(aSubscriptionRequest().forCustomer('cust_unknown').onPlan('basic').build());

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('CUSTOMER_NOT_FOUND');
    expectNoDatabaseChanges(env, before);
    expect(env.provider.callCount).toBe(0);
  });

  test('API-06 unknown plan -> 422 INVALID_PLAN, nothing persisted, no provider call', async () => {
    const before = env.repos.snapshots.snapshot();
    const res = await env.api.create(aSubscriptionRequest().onPlan('enterprise').build());

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('INVALID_PLAN');
    expectNoDatabaseChanges(env, before);
    expect(env.provider.callCount).toBe(0);
  });

  test('API-07 invalid payment method -> 422 INVALID_PAYMENT_METHOD, no provider call', async () => {
    const before = env.repos.snapshots.snapshot();
    const res = await env.api.create(aSubscriptionRequest().onPlan('basic').withPaymentMethod('card_4242').build());

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('INVALID_PAYMENT_METHOD');
    expectNoDatabaseChanges(env, before);
    expect(env.provider.callCount).toBe(0);
  });

  test('a customer created at runtime (builder) can subscribe', async () => {
    const customer = aCustomer().build();
    env.repos.customers.insert(customer);
    const res = await env.api.create(aSubscriptionRequest().forCustomer(customer.id).build());
    expect(res.status).toBe(201);
    expect(res.body.customer_id).toBe(customer.id);
  });
});
