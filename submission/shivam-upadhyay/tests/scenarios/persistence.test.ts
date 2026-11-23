import { describe, expect, it } from 'vitest';
import { invoicesFor } from '../assertions/verify';
import { WebhookPayloadBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/** G — persistence / auditability: records match the API at every stage. */
describe('G — persistence & auditability', () => {
  it('persisted state matches the API-visible result at every stage', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    let res = await ctx.api.get(id);
    expect(res.body['state']).toBe('trialing');
    expect(ctx.store.subscriptions.get(id)!.state).toBe('trialing');

    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    res = await ctx.api.get(id);
    expect(res.body['state']).toBe('active');
    expect(ctx.store.subscriptions.get(id)!.state).toBe('active');
    expect(invoicesFor(ctx, id).some((i) => i.status === 'paid')).toBe(true);

    await ctx.api.cancel(id);
    res = await ctx.api.get(id);
    expect(res.body['state']).toBe('canceled');
    expect(ctx.store.subscriptions.get(id)!.state).toBe('canceled');
  });

  it('never active without at least one successful persisted payment', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    const stored = ctx.store.subscriptions.get(id)!;
    expect(stored.state).toBe('active');
    expect(invoicesFor(ctx, id).filter((i) => i.status === 'paid')).toHaveLength(1);
  });

  it('a canceled subscription never transitions again', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    await ctx.api.cancel(id);
    const auditBefore = ctx.store.auditLog.filter((e) => e.subscriptionId === id).length;
    await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt_after_cancel')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_777')
        .amount(4900)
        .build(),
    );
    expect(ctx.store.subscriptions.get(id)!.state).toBe('canceled');
    const auditAfter = ctx.store.auditLog.filter((e) => e.subscriptionId === id).length;
    expect(auditAfter).toBe(auditBefore);
  });

  it('the audit log is queryable and ordered per subscription', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    await ctx.api.cancel(id);
    const kinds = ctx.store.auditLog.filter((e) => e.subscriptionId === id).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'trial_charge_succeeded', 'cancel']);
  });
});
