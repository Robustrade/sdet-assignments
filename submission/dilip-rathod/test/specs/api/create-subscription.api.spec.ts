import { describe, expect, it } from 'vitest';
import { expectError } from '../../support/api/HttpClient';
import { expectCharges, expectNoCharges, expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { aCustomer, aSubscriptionRequest } from '../../support/builders/builders';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('POST /subscriptions', () => {
  const env = useTestEnvironment({ startAt: '2026-01-01T09:00:00.000Z' });

  describe('plan with a trial (pro)', () => {
    it('creates a trialing subscription with a 14-day trial and does not charge', async () => {
      const customer = env().seed.customer();

      const sub = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

      expect(sub).toMatchObject({
        customer_id: customer.id,
        payment_method_id: customer.paymentMethodIds[0],
        plan: 'pro',
        status: 'trialing',
        trial_ends_at: '2026-01-15T09:00:00.000Z',
        next_billing_at: '2026-01-15T09:00:00.000Z',
        current_period_start: null,
        retry_count: 0,
        canceled_at: null,
        latest_invoice: null,
      });
      expectNoCharges(env().provider);
      await expectSubscriptionState(env(), sub.id, { status: 'trialing', plan: 'pro', invoices: [], history: ['∅->trialing'] });
    });
  });

  describe('plan without a trial (basic)', () => {
    it('charges the plan price immediately and responds active', async () => {
      const customer = env().seed.customer();

      const sub = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());

      expect(sub).toMatchObject({
        status: 'active',
        trial_ends_at: null,
        current_period_start: '2026-01-01T09:00:00.000Z',
        current_period_end: '2026-01-31T09:00:00.000Z',
        next_billing_at: '2026-01-31T09:00:00.000Z',
        latest_invoice: { amount: 1900, currency: 'USD', status: 'paid' },
      });
      expectCharges(env().provider, [
        {
          customerId: customer.id,
          paymentMethodId: customer.paymentMethodIds[0],
          amount: 1900,
          currency: 'USD',
          reference: sub.latest_invoice!.id,
          idempotencyKey: `${sub.latest_invoice!.id}:1`,
        },
      ]);
      await expectSubscriptionState(env(), sub.id, { status: 'active', invoices: ['paid'], history: ['∅->trialing', 'trialing->active'] });
    });

    it('responds past_due — not active, not rejected — when the immediate charge is declined', async () => {
      env().provider.willDecline('insufficient_funds');

      const sub = await env().api.create(aSubscriptionRequest().forCustomer(env().seed.customer()).onPlan('basic').build());

      expect(sub.status).toBe('past_due');
      expect(sub.latest_invoice).toMatchObject({ status: 'open', amount: 1900 });
      const [attempt] = env().db.attemptsFor(sub.latest_invoice!.id);
      expect(attempt).toMatchObject({ status: 'declined', decline_code: 'insufficient_funds', resolved_by: 'provider_response' });
      await expectSubscriptionState(env(), sub.id, { status: 'past_due', invoices: ['open'] });
    });
  });

  describe('validation failures persist nothing and never reach the provider', () => {
    const shapeErrors: Array<[string, (b: ReturnType<typeof aSubscriptionRequest>) => unknown, string]> = [
      ['missing customer_id', (b) => b.without('customer_id').build(), 'customer_id'],
      ['missing plan', (b) => b.without('plan').build(), 'plan'],
      ['missing payment_method_id', (b) => b.without('payment_method_id').build(), 'payment_method_id'],
      ['empty plan', (b) => b.with('plan', '').build(), 'plan'],
      ['numeric customer_id', (b) => b.with('customer_id', 42).build(), 'customer_id'],
      ['null payment_method_id', (b) => b.with('payment_method_id', null).build(), 'payment_method_id'],
      ['array body', () => [], '(body)'],
    ];

    it.each(shapeErrors)('400 validation_error for %s', async (_case, makeBody, field) => {
      const builder = aSubscriptionRequest().forCustomer(env().seed.customer());
      const before = env().db.counts();

      const res = await env().api.createSubscription(makeBody(builder));

      const error = expectError(res, 400, 'validation_error');
      expect(error.error.details?.map((d) => d.field)).toContain(field);
      expectRowDeltas(before, env().db.counts());
      expectNoCharges(env().provider);
    });

    it('400 malformed_json for a body that is not JSON', async () => {
      const before = env().db.counts();
      expectError(await env().api.createSubscriptionRaw('{"customer_id": '), 400, 'malformed_json');
      expectRowDeltas(before, env().db.counts());
    });

    it('422 unknown_plan', async () => {
      const customer = env().seed.customer();
      const before = env().db.counts();
      const res = await env().api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('enterprise').build());
      expectError(res, 422, 'unknown_plan');
      expectRowDeltas(before, env().db.counts());
      expectNoCharges(env().provider);
    });

    it('422 unknown_customer', async () => {
      const ghost = aCustomer().withId('cust_does_not_exist').build();
      const before = env().db.counts();
      const res = await env().api.createSubscription(aSubscriptionRequest().forCustomer(ghost).onPlan('basic').build());
      expectError(res, 422, 'unknown_customer');
      expectRowDeltas(before, env().db.counts());
      expectNoCharges(env().provider);
    });

    it('422 invalid_payment_method for an unknown payment method', async () => {
      const res = await env().api.createSubscription(
        aSubscriptionRequest().forCustomer(env().seed.customer()).onPlan('basic').withPaymentMethod('pm_unknown').build(),
      );
      expectError(res, 422, 'invalid_payment_method');
      expectNoCharges(env().provider);
    });

    it("422 invalid_payment_method for another customer's payment method", async () => {
      const alice = env().seed.customer();
      const mallory = env().seed.customer();
      const before = env().db.counts();

      const res = await env().api.createSubscription(
        aSubscriptionRequest().forCustomer(mallory).onPlan('basic').withPaymentMethod(alice.paymentMethodIds[0]).build(),
      );

      expectError(res, 422, 'invalid_payment_method');
      expectRowDeltas(before, env().db.counts());
      expectNoCharges(env().provider);
    });
  });
});
