import { describe, expect, it } from 'vitest';
import { expectProviderCalls, expectState } from '../assertions/verify';
import { CreateSubscriptionBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/** B — validation failures: correct response AND no invalid side effects. */
describe('B — validation failures', () => {
  it('unknown plan is rejected and nothing is persisted or charged', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().plan('enterprise').build());
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('unknown_plan');
    expect(ctx.store.subscriptions.size).toBe(0);
    expectProviderCalls(ctx, 0);
  });

  it('missing customer_id is rejected', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().without('customer_id').build());
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('missing_field');
    expect(res.body['field']).toBe('customer_id');
  });

  it('missing payment_method_id is rejected', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().without('payment_method_id').build());
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('missing_field');
    expect(res.body['field']).toBe('payment_method_id');
  });

  it('unknown customer is rejected', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().customer('cust_999').build());
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('unknown_customer');
    expect(ctx.store.subscriptions.size).toBe(0);
  });

  it('canceling an already-canceled subscription is rejected', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    expect((await ctx.api.cancel(id)).status).toBe(200);
    const again = await ctx.api.cancel(id);
    expect(again.status).toBe(409);
    expect(again.body['error']).toBe('cancel_not_allowed');
    expectState(ctx, id, 'canceled');
  });

  it('cancel from past_due is rejected (closed transition list)', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    const res = await ctx.api.cancel(id);
    expect(res.status).toBe(409);
    expectState(ctx, id, 'past_due');
  });

  it('unknown subscription ids return 404', async () => {
    const ctx = createTestContext();
    expect((await ctx.api.get('sub_nope')).status).toBe(404);
    expect((await ctx.api.cancel('sub_nope')).status).toBe(404);
  });

  it('webhook for an unknown subscription returns 404', async () => {
    const ctx = createTestContext();
    const res = await ctx.webhooks.send({
      event_id: 'evt_ghost',
      type: 'payment.succeeded',
      subscription_id: 'sub_nope',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD',
    });
    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('subscription_not_found');
  });
});
