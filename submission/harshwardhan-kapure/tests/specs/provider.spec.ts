import { beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/TestContext';
import { aSubscription, aWebhook } from '../support/builders';
import {
  expectApiMatchesDb,
  expectNeverActiveWithoutPaidInvoice,
  expectProviderCalledWith
} from '../support/assertions';

describe('Mock Payment Provider Integration', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create();
  });

  it('calls provider once with exact plan amount, customer, payment method, and idempotency ref on basic creation', async () => {
    const customer = ctx.seedCustomer((b) => b.withId('cust_prov_1').withPaymentMethods('pm_mastercard_9999'));
    ctx.provider.respondWithSuccess();

    const sub = await ctx.createSubscriptionViaApi(customer, 'basic', 'pm_mastercard_9999');

    expect(ctx.provider.getCallCount()).toBe(1);
    expectProviderCalledWith(ctx.provider, {
      customerId: 'cust_prov_1',
      amount: 1900,
      paymentMethodId: 'pm_mastercard_9999',
      idempotencyRef: /^inv_/
    });
    expect(sub.status).toBe('active');
    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
  });

  it('calls provider with pro plan price (4900) when trial ends, not on creation', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    expect(ctx.provider.getCallCount()).toBe(0);

    ctx.provider.respondWithSuccess();
    const billRes = await ctx.api.billSubscription(sub.id);

    expect(billRes.status).toBe(200);
    expect(ctx.provider.getCallCount()).toBe(1);
    expectProviderCalledWith(ctx.provider, {
      customerId: customer.id,
      amount: 4900,
      paymentMethodId: customer.payment_methods[0]
    });
    expect(billRes.body.subscription.status).toBe('active');
  });

  it('moves subscription to past_due with failed invoice and zero paid records on provider decline', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    ctx.provider.respondWithDecline();
    const billRes = await ctx.api.billSubscription(sub.id);

    expect(billRes.status).toBe(200);
    expect(billRes.body.outcome).toBe('declined');
    expect(billRes.body.subscription.status).toBe('past_due');

    const invoices = ctx.repo.findInvoicesBySubscriptionId(sub.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('failed');
    expect(invoices[0].provider_outcome).toBe('declined');
    expect(invoices.filter((i) => i.status === 'paid')).toHaveLength(0);

    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
  });

  it('handles provider timeout safely without activating subscription or writing a success invoice', async () => {
    const customer = ctx.seedCustomer();
    ctx.provider.respondWithTimeout();

    const res = await ctx.api.createSubscription(
      aSubscription().forCustomer(customer.id).basic().buildRequest()
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');

    const invoices = ctx.repo.findInvoicesBySubscriptionId(res.body.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('failed');
    expect(invoices[0].provider_outcome).toBe('timeout');
    expect(invoices.filter((i) => i.status === 'paid')).toHaveLength(0);

    expectNeverActiveWithoutPaidInvoice(ctx.repo, res.body.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, res.body.id);
  });

  it('recovers cleanly from thrown provider error without leaving a dangling pending invoice', async () => {
    const customer = ctx.seedCustomer();
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

    ctx.provider.respondWithError(new Error('ETIMEDOUT calling gateway'));
    const billRes = await ctx.api.billSubscription(sub.id);

    expect(billRes.status).toBe(502);
    expect(billRes.body.error).toContain('ETIMEDOUT');
    expect(billRes.body.subscription.status).toBe('past_due');

    const invoices = ctx.repo.findInvoicesBySubscriptionId(sub.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('failed');
    expect(invoices[0].provider_outcome).toBe('error');
    expect(invoices.filter((i) => i.status === 'pending')).toHaveLength(0);

    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
  });

  it('never calls payment provider for rejected creations, cancellations, or replayed webhooks', async () => {
    const customer = ctx.seedCustomer();

    // 1. Rejected creation
    await ctx.api.createSubscription({ customer_id: customer.id, plan: 'unknown', payment_method_id: 'pm_test_visa_4242' });
    expect(ctx.provider.getCallCount()).toBe(0);

    // 2. Pro creation + cancellation
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');
    await ctx.api.cancelSubscription(sub.id);
    expect(ctx.provider.getCallCount()).toBe(0);

    // 3. Billing attempt on canceled subscription is rejected without calling provider
    const billCanceled = await ctx.api.billSubscription(sub.id);
    expect(billCanceled.status).toBe(409);
    expect(ctx.provider.getCallCount()).toBe(0);

    // 4. Replayed webhook does not call provider
    const wh = aWebhook().paymentSucceeded().forSubscription(sub.id).signed();
    await ctx.api.sendWebhook(wh);
    await ctx.api.sendWebhook(wh);
    expect(ctx.provider.getCallCount()).toBe(0);
  });
});
