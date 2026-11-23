import { describe, expect, it } from 'vitest';
import {
  expectAuditKind,
  expectInvoice,
  expectInvoiceCount,
  expectProviderCalls,
  expectState,
} from '../assertions/verify';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/** C — payment failure: past_due, never active or canceled by a failure. */
describe('C — payment failure', () => {
  it('failed first charge moves the subscription to past_due', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    expectInvoice(ctx, id, 'failed', 4900);
    expectInvoiceCount(ctx, id, 1);
    expectAuditKind(ctx, id, 'trial_charge_failed');
  });

  it('a timed-out first charge changes nothing (safe retry later)', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'timeout';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'trialing');
    expectInvoiceCount(ctx, id, 0);
    expectProviderCalls(ctx, 1);
    expectAuditKind(ctx, id, 'charge_timeout');
  });

  it('a declined retry keeps past_due and counts the retry', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    const stored = ctx.store.subscriptions.get(id)!;
    await ctx.billing.retryPastDue(stored);
    expectState(ctx, id, 'past_due');
    expect(stored.retryCount).toBe(1);
    expectInvoiceCount(ctx, id, 2);
    expectProviderCalls(ctx, 2);
  });
});
