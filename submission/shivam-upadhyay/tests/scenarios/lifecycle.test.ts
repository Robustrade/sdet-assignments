import { describe, expect, it } from 'vitest';
import { nextState } from '../../src/lifecycle';
import { expectInvoice, expectInvoiceCount, expectProviderCalls, expectState } from '../assertions/verify';
import { WebhookPayloadBuilder } from '../builders/builders';
import { advancePastProTrial, createSubscription, createTestContext } from '../fixtures/setup';

/** E — state-machine invariants: every valid transition, invalid ones impossible. */
describe('E — state-machine invariants', () => {
  it('trialing → active when the first charge succeeds', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    expectInvoice(ctx, id, 'paid', 4900);
    expectProviderCalls(ctx, 1);
  });

  it('trialing → past_due when the first charge fails', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    expectInvoice(ctx, id, 'failed', 4900);
  });

  it('active → past_due when a recurring charge fails (webhook)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt-rec-fail')
        .type('payment.failed')
        .subscriptionId(id)
        .invoiceId('inv_002')
        .amount(4900)
        .build(),
    );
    expect(res.status).toBe(200);
    expectState(ctx, id, 'past_due');
    expectInvoice(ctx, id, 'failed', 4900);
  });

  it('past_due → active when a retry succeeds', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    ctx.mock.defaultBehavior = 'success';
    const stored = ctx.store.subscriptions.get(id);
    expect(stored).toBeDefined();
    await ctx.billing.retryPastDue(stored!);
    expectState(ctx, id, 'active');
    expect(stored!.retryCount).toBe(0);
    expectInvoice(ctx, id, 'paid', 4900);
  });

  it('past_due → canceled when retries are exhausted', async () => {
    const ctx = createTestContext();
    ctx.mock.defaultBehavior = 'decline';
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'past_due');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const stored = ctx.store.subscriptions.get(id)!;
      await ctx.billing.retryPastDue(stored);
    }
    expectState(ctx, id, 'canceled');
    expectInvoiceCount(ctx, id, 4); // 1 failed trial + 3 failed retries
    expectProviderCalls(ctx, 4);
  });

  it('active → canceled via API cancel', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    advancePastProTrial(ctx);
    await ctx.billing.processTrialEnds();
    expectState(ctx, id, 'active');
    const res = await ctx.api.cancel(id);
    expect(res.status).toBe(200);
    expectState(ctx, id, 'canceled');
  });

  it('trialing → canceled via API cancel', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    const res = await ctx.api.cancel(id);
    expect(res.status).toBe(200);
    expectState(ctx, id, 'canceled');
  });

  it('canceled → active is impossible (stray payment.succeeded webhook)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    await ctx.api.cancel(id);
    expectState(ctx, id, 'canceled');
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt-stray-ok')
        .type('payment.succeeded')
        .subscriptionId(id)
        .invoiceId('inv_099')
        .amount(4900)
        .build(),
    );
    expect(res.status).toBe(200);
    expect(res.body['status']).toBe('ignored');
    expectState(ctx, id, 'canceled');
    expectInvoiceCount(ctx, id, 0);
  });

  it('canceled → past_due is impossible (stray payment.failed webhook)', async () => {
    const ctx = createTestContext();
    const sub = await createSubscription(ctx);
    const id = sub['id'] as string;
    await ctx.api.cancel(id);
    const res = await ctx.webhooks.send(
      new WebhookPayloadBuilder()
        .eventId('evt-stray-fail')
        .type('payment.failed')
        .subscriptionId(id)
        .invoiceId('inv_100')
        .amount(4900)
        .build(),
    );
    expect(res.status).toBe(200);
    expect(res.body['status']).toBe('ignored');
    expectState(ctx, id, 'canceled');
    expectInvoiceCount(ctx, id, 0);
  });

  it('the transition table forbids backward moves', () => {
    expect(nextState('active', 'trial_charge_succeeded')).toBeNull();
    expect(nextState('canceled', 'retry_succeeded')).toBeNull();
    expect(nextState('past_due', 'trial_charge_succeeded')).toBeNull();
    expect(nextState('trialing', 'retry_succeeded')).toBeNull();
  });
});
