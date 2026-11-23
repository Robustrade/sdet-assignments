import { describe, expect, it } from 'vitest';
import { expectInvoice, expectProviderCalls, expectState } from '../assertions/verify';
import { CreateSubscriptionBuilder } from '../builders/builders';
import {
  advancePastBasicTrial,
  advancePastProTrial,
  createSubscription,
  createTestContext,
} from '../fixtures/setup';

/** A — creation & activation. */
describe('A — creation & activation', () => {
  it('creates a basic subscription in trialing', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().plan('basic').build());
    expect(res.status).toBe(201);
    expect(res.body['state']).toBe('trialing');
    expect(res.body['plan']).toBe('basic');
    expect(res.body['customer_id']).toBe('cust_001');
    expect(res.body['payment_method_id']).toBe('pm_test_visa_4242');
  });

  it('creates a pro subscription in trialing with a 7-day trial', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    expect(sub['state']).toBe('trialing');
    const trialEndsAt = sub['trial_ends_at'] as number;
    const createdAt = sub['created_at'] as number;
    expect(trialEndsAt - createdAt).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('GET returns the created subscription', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const res = await ctx.api.get(id);
    expect(res.status).toBe(200);
    expect(res.body['id']).toBe(id);
    expect(res.body['state']).toBe('trialing');
  });

  it('provider is not called at creation', async () => {
    const ctx = createTestContext();
    await createSubscription(ctx);
    expectProviderCalls(ctx, 0);
  });

  it('trial success activates with the correct charge (pro, $49)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    expectInvoice(ctx, id, 'paid', 4900);
    expectProviderCalls(ctx, 1);
    const call = ctx.mock.calls[0]!;
    expect(call.customerId).toBe('cust_001');
    expect(call.paymentMethodId).toBe('pm_test_visa_4242');
    expect(call.amountCents).toBe(4900);
    expect(call.currency).toBe('USD');
    expect(call.idempotencyKey).toBe(`trial-${id}`);
  });

  it('trial success charges the basic price ($19)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx, { plan: 'basic' });
    const id = sub['id'] as string;
    advancePastBasicTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    expectInvoice(ctx, id, 'paid', 1900);
  });
});
