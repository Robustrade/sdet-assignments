import { describe, expect, it } from 'vitest';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

describe('G1: end-to-end subscription journey', () => {
  const env = useTestEnvironment();

  it('signup -> failed trial charge -> retry -> renewal -> cancel -> stray webhook, consistent at every step', async () => {
    const { api, provider, clock, assert, db } = env();
    const customer = env().seedCustomer();

    // 1. Signup on basic: trialing, nothing charged.
    const created = await api.create(aSubscriptionRequest().forCustomer(customer).onPlan('basic').build());
    const id = created.body.id;
    expect((await assert.expectConsistent(id)).status).toBe('trialing');

    // 2. Trial ends, card declined: past_due.
    clock.advanceDays(14);
    provider.willDecline();
    await api.runBilling(id);
    expect((await assert.expectConsistent(id)).status).toBe('past_due');

    // 3. Next day's retry succeeds: active, same invoice now paid.
    clock.advanceDays(1);
    provider.willSucceed();
    await api.runBilling(id);
    const activated = await assert.expectConsistent(id);
    expect(activated).toMatchObject({ status: 'active', retry_count: 0 });

    // 4. A month later the renewal succeeds: still active, second invoice paid.
    clock.advanceDays(30);
    provider.willSucceed();
    await api.runBilling(id);
    expect((await assert.expectConsistent(id)).status).toBe('active');

    // 5. Customer cancels.
    clock.advanceDays(3);
    const canceled = await api.cancel(id);
    expect(canceled.body.canceled_at).toBe(clock.now().toISOString());

    // 6. The provider re-sends a success for the renewal charge: nothing pending, so stale.
    const stray = await env().webhooks.deliver(
      env().simulator.signed(aWebhook().paymentSucceeded().forCharge(provider.lastCall()).build()),
    );
    expect(stray.body.outcome).toBe('ignored_stale');
    const final = await assert.expectConsistent(id);
    expect(final.status).toBe('canceled');

    // The whole history, from three independent angles.
    expect(assert.transitionsOf(id)).toEqual([
      '∅->trialing',
      'trialing->past_due',
      'past_due->active',
      'active->canceled',
    ]);
    const [inv1, inv2] = db.invoicesFor(id);
    expect(db.invoicesFor(id).map((i) => [i.amount, i.status])).toEqual([
      [1900, 'paid'],
      [1900, 'paid'],
    ]);
    expect(provider.calls.map((c) => c.idempotencyKey)).toEqual([
      `${inv1!.id}:attempt:1`,
      `${inv1!.id}:attempt:2`,
      `${inv2!.id}:attempt:1`,
    ]);
    expect(env().notifier.activationsFor(id)).toBe(1);

    // Timestamps are coherent: audit entries in time order, updated_at never before created_at.
    const times = db.auditLog(id).map((e) => e.at);
    expect(times).toEqual([...times].sort());
    expect(Date.parse(final.updated_at)).toBeGreaterThanOrEqual(Date.parse(final.created_at));
  });
});
