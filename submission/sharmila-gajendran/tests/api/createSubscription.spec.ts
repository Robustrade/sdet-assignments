import { describe, expect, it } from 'vitest';
import { aSubscriptionRequest } from '../support/builders/subscriptionRequestBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS, CUSTOMER_1, CUSTOMER_2, EXPECTED_PLANS } from '../support/testData';
import { daysAfter } from '../support/time';

describe('POST /subscriptions', () => {
  const ctx = useTestContext();

  describe('A. creation and activation', () => {
    it('A1: a pro subscription starts in trialing with a 14-day trial and no charge', async () => {
      const { api, clock, dbCheck, providerCheck } = ctx();

      const response = await api.createSubscription(aSubscriptionRequest().onPlan('pro').build());

      expect(response.status).toBe(201);
      const subscription = response.data();
      expect(subscription).toMatchObject({
        customer_id: CUSTOMER_1.id,
        payment_method_id: CUSTOMER_1.paymentMethodId,
        plan: 'pro',
        status: 'trialing',
        trial_ends_at: daysAfter(clock.now(), EXPECTED_PLANS.pro.trialDays),
        current_period_end: null,
        canceled_at: null,
        created_at: clock.now().toISOString(),
      });
      providerCheck.expectNoCharges();
      dbCheck.expectMatchesApi(subscription);
      expect(dbCheck.invoices(subscription.id)).toEqual([]);
      expect(dbCheck.auditTrail(subscription.id)).toMatchObject([
        { kind: 'created', fromStatus: null, toStatus: 'trialing', source: 'api' },
      ]);
    });

    it('returns exactly the documented fields', async () => {
      const response = await ctx().api.createSubscription(aSubscriptionRequest().build());

      expect(Object.keys(response.body as object).sort()).toEqual([
        'canceled_at',
        'created_at',
        'current_period_end',
        'customer_id',
        'id',
        'payment_method_id',
        'plan',
        'status',
        'trial_ends_at',
        'updated_at',
      ]);
    });

    it('A2: a basic subscription is charged on create and comes back active', async () => {
      const { api, clock, dbCheck, providerCheck } = ctx();

      const response = await api.createSubscription(aSubscriptionRequest().forCustomer(CUSTOMER_2).onPlan('basic').build());

      expect(response.status).toBe(201);
      const subscription = response.data();
      expect(subscription.status).toBe('active');
      expect(subscription.current_period_end).toBe(daysAfter(clock.now(), BILLING_PERIOD_DAYS));

      const invoice = dbCheck.onlyInvoice(subscription.id);
      expect(invoice).toMatchObject({ amountCents: 1900, currency: 'USD', status: 'paid', idempotencyKey: invoice.id });
      expect(invoice.providerChargeId).not.toBeNull();
      providerCheck.expectOnlyCharge({
        amountCents: 1900,
        currency: 'USD',
        customerId: CUSTOMER_2.id,
        paymentMethodId: CUSTOMER_2.paymentMethodId,
        idempotencyKey: invoice.id,
        reference: subscription.id,
      });
      dbCheck.expectMatchesApi(subscription);
      expect(dbCheck.transitions(subscription.id)).toEqual([
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      ]);
    });
  });

  describe('B. validation failures save nothing and charge nothing', () => {
    it.each([
      { problem: 'customer_id is missing', body: aSubscriptionRequest().without('customer_id').build() },
      { problem: 'plan is missing', body: aSubscriptionRequest().without('plan').build() },
      { problem: 'payment_method_id is missing', body: aSubscriptionRequest().without('payment_method_id').build() },
      { problem: 'plan is not a string', body: aSubscriptionRequest().with('plan', 42).build() },
      { problem: 'customer_id is blank', body: aSubscriptionRequest().with('customer_id', '   ').build() },
    ])('B2: returns 400 when $problem', async ({ body }) => {
      const { api, dbCheck, providerCheck } = ctx();

      const response = await api.createSubscription(body);

      expect(response.status).toBe(400);
      expect(response.errorCode()).toBe('VALIDATION_ERROR');
      dbCheck.expectNothingStored();
      providerCheck.expectNoCharges();
    });

    it('returns 400 when the body is not valid JSON', async () => {
      const { api, dbCheck, providerCheck } = ctx();

      const response = await api.createSubscriptionRaw('{"customer_id": "cust_001", "plan": ');

      expect(response.status).toBe(400);
      expect(response.errorCode()).toBe('MALFORMED_PAYLOAD');
      dbCheck.expectNothingStored();
      providerCheck.expectNoCharges();
    });

    it.each([
      { problem: 'B1: the plan does not exist', body: aSubscriptionRequest().onPlan('enterprise').build(), code: 'UNKNOWN_PLAN' },
      {
        problem: 'B3: the customer does not exist',
        body: aSubscriptionRequest().withCustomerId('cust_999').build(),
        code: 'CUSTOMER_NOT_FOUND',
      },
      {
        problem: "B4: the payment method belongs to another customer",
        body: aSubscriptionRequest().withPaymentMethod(CUSTOMER_2.paymentMethodId).build(),
        code: 'INVALID_PAYMENT_METHOD',
      },
      {
        problem: 'the payment method does not exist',
        body: aSubscriptionRequest().withPaymentMethod('pm_missing').build(),
        code: 'INVALID_PAYMENT_METHOD',
      },
    ])('returns 422 when $problem', async ({ body, code }) => {
      const { api, dbCheck, providerCheck } = ctx();

      const response = await api.createSubscription(body);

      expect(response.status).toBe(422);
      expect(response.errorCode()).toBe(code);
      dbCheck.expectNothingStored();
      providerCheck.expectNoCharges();
    });
  });

  describe('B6. unknown subscription id', () => {
    it('GET returns 404', async () => {
      const response = await ctx().api.getSubscription('sub_does_not_exist');

      expect(response.status).toBe(404);
      expect(response.errorCode()).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('cancel returns 404 and saves nothing', async () => {
      const { api, dbCheck } = ctx();

      const response = await api.cancelSubscription('sub_does_not_exist');

      expect(response.status).toBe(404);
      expect(response.errorCode()).toBe('SUBSCRIPTION_NOT_FOUND');
      dbCheck.expectNothingStored();
    });
  });
});
