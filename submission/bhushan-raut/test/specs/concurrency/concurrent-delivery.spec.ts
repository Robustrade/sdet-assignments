import { describe, expect, it, vi } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

/**
 * Bonus (X1). Requests are fired concurrently with Promise.all through the real HTTP
 * stack. Node runs one request's synchronous section at a time, so these prove the
 * service's check-then-act sections are never split by an await — not database-level
 * races between processes (see STRATEGY.md §11).
 */
describe('X1: concurrent requests for the same subscription', () => {
  const env = useTestEnvironment();

  it('the same event delivered twice at once is applied once', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    const event = env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build());

    const results = await Promise.all([env().webhooks.deliver(event), env().webhooks.deliver(event)]);

    expect(results.map((r) => r.body.duplicate).sort()).toEqual([false, true]);
    expect((await env().assert.expectConsistent(subscription.id)).status).toBe('active');
    expect(env().notifier.activationsFor(subscription.id)).toBe(1);
  });

  it('conflicting outcomes for the same charge at once: exactly one wins, the other is stale', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();

    const results = await Promise.all([
      env().webhooks.deliver(env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build())),
      env().webhooks.deliver(env().simulator.signed(aWebhook().paymentFailed().forCharge(charge).build())),
    ]);

    expect(results.map((r) => r.body.outcome).sort()).toEqual(['applied', 'ignored_stale']);
    const view = await env().assert.expectConsistent(subscription.id);
    expect(['active', 'past_due']).toContain(view.status);
    expect(env().assert.transitionsOf(subscription.id)).toHaveLength(2);
  });

  it('a second billing run while the first charge is in flight does not charge again', async () => {
    const sub = await env().given.trialingSubscription('basic');
    env().clock.advanceDays(14);
    const release = env().provider.willSucceedWhenReleased();

    const first = env().api.runBilling(sub.id);
    await vi.waitFor(() => expect(env().provider.calls).toHaveLength(1)); // first run is now blocked mid-charge
    const second = await env().api.runBilling(sub.id);
    release();

    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('charge_in_flight');
    expect((await first).status).toBe(200);
    expect(env().provider.calls).toHaveLength(1);
    expect((await env().assert.expectConsistent(sub.id)).status).toBe('active');
  });

  it('a cancel while the signup charge is in flight wins: the late success does not reactivate', async () => {
    const customerSub = await env().given.trialingSubscription('basic');
    env().clock.advanceDays(14);
    const release = env().provider.willSucceedWhenReleased();

    const billing = env().api.runBilling(customerSub.id);
    await vi.waitFor(() => expect(env().provider.calls).toHaveLength(1));
    expect((await env().api.cancel(customerSub.id)).status).toBe(200);
    release();

    expect((await billing).body.result).toBe('ignored_invalid_transition');
    expect((await env().assert.expectConsistent(customerSub.id)).status).toBe('canceled');
    expect(env().notifier.activationsFor(customerSub.id)).toBe(0);
  });
});
