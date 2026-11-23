import { describe, expect, it } from 'vitest';
import { expectProviderCalls } from '../assertions/verify';
import { CreateSubscriptionBuilder, WebhookPayloadBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/** F — mocked provider: call count and arguments, not just "called". */
describe('F — mocked provider', () => {
  it('is called exactly once per genuine billing attempt', async () => {
    const ctx = createTestContext();
    ctx.mock.behaviorQueue = ['decline', 'success'];
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectProviderCalls(ctx, 1);
    const stored = ctx.store.subscriptions.get(id)!;
    await ctx.billing.retryPastDue(stored);
    expectProviderCalls(ctx, 2);
  });

  it('is not called for a rejected creation', async () => {
    const ctx = createTestContext();
    const res = await ctx.api.create(new CreateSubscriptionBuilder().plan('nope').build());
    expect(res.status).toBe(400);
    expectProviderCalls(ctx, 0);
  });

  it('is not called for a replayed webhook', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const payload = new WebhookPayloadBuilder()
      .eventId('evt_replay')
      .type('payment.succeeded')
      .subscriptionId(id)
      .invoiceId('inv_001')
      .amount(4900)
      .build();
    await ctx.webhooks.send(payload);
    await ctx.webhooks.send(payload);
    expectProviderCalls(ctx, 0);
  });

  it('is not called for a cancel (cancel needs no charge)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectProviderCalls(ctx, 1);
    await ctx.api.cancel(id);
    expectProviderCalls(ctx, 1);
  });

  it('receives the right arguments on a retry (new idempotency key)', async () => {
    const ctx = createTestContext();
    ctx.mock.behaviorQueue = ['decline', 'success'];
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    const stored = ctx.store.subscriptions.get(id)!;
    await ctx.billing.retryPastDue(stored);
    expect(ctx.mock.calls).toHaveLength(2);
    expect(ctx.mock.calls[0]!.idempotencyKey).toBe(`trial-${id}`);
    expect(ctx.mock.calls[1]!.idempotencyKey).toBe(`retry-${id}-1`);
    expect(ctx.mock.calls[1]!.amountCents).toBe(4900);
    expect(ctx.mock.calls[1]!.customerId).toBe('cust_001');
  });
});
