import { describe, expect, it } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment, type TestEnvironment } from '../../framework/env/TestEnvironment';
import type { WithPendingCharge } from '../../framework/env/Given';

/** The 7 valid transitions from the brief's lifecycle diagram. */
const DIAGRAM = [
  'trialing->active',
  'trialing->past_due',
  'active->past_due',
  'past_due->active',
  'past_due->canceled',
  'active->canceled',
  'trialing->canceled',
];

type Drive = (env: TestEnvironment) => Promise<string>;

async function runBilling(env: TestEnvironment, subscriptionId: string): Promise<string> {
  const res = await env.api.runBilling(subscriptionId);
  expect(res.status, 'billing run').toBe(200);
  return subscriptionId;
}

async function settle(env: TestEnvironment, pending: WithPendingCharge, type: 'succeeded' | 'failed') {
  const event = type === 'succeeded' ? aWebhook().paymentSucceeded() : aWebhook().paymentFailed();
  const res = await env.webhooks.deliver(env.simulator.signed(event.forCharge(pending.charge).build()));
  expect(res.body.outcome, 'webhook outcome').toBe('applied');
  return pending.subscription.id;
}

/** Each valid transition, triggered by the service's own billing run or the cancel API. */
const VIA_API_AND_BILLING: Record<string, Drive> = {
  'trialing->active': async (env) => {
    const sub = await env.given.trialingSubscription('basic');
    env.clock.advanceDays(14);
    env.provider.willSucceed();
    return runBilling(env, sub.id);
  },
  'trialing->past_due': async (env) => {
    const sub = await env.given.trialingSubscription('basic');
    env.clock.advanceDays(14);
    env.provider.willDecline();
    return runBilling(env, sub.id);
  },
  'active->past_due': async (env) => {
    const sub = await env.given.activeSubscription();
    env.clock.advanceDays(30);
    env.provider.willDecline();
    return runBilling(env, sub.id);
  },
  'past_due->active': async (env) => {
    const sub = await env.given.pastDueSubscription();
    env.provider.willSucceed();
    return runBilling(env, sub.id);
  },
  'past_due->canceled': async (env) => {
    const sub = await env.given.pastDueAfterRetries(2);
    env.provider.willDecline();
    return runBilling(env, sub.id);
  },
  'active->canceled': async (env) => {
    const sub = await env.given.activeSubscription();
    expect((await env.api.cancel(sub.id)).status).toBe(200);
    return sub.id;
  },
  'trialing->canceled': async (env) => {
    const sub = await env.given.trialingSubscription();
    expect((await env.api.cancel(sub.id)).status).toBe(200);
    return sub.id;
  },
};

/** The charge-driven transitions again, this time settled by an asynchronous provider webhook. */
const VIA_WEBHOOK: Record<string, Drive> = {
  'trialing->active': async (env) => settle(env, await env.given.subscriptionWithPendingFirstCharge(), 'succeeded'),
  'trialing->past_due': async (env) => settle(env, await env.given.subscriptionWithPendingFirstCharge(), 'failed'),
  'active->past_due': async (env) => settle(env, await env.given.activeWithPendingRenewal(), 'failed'),
  'past_due->active': async (env) => settle(env, await env.given.pastDueWithPendingRetry(), 'succeeded'),
  'past_due->canceled': async (env) => {
    const sub = await env.given.pastDueAfterRetries(2);
    env.provider.willTimeout();
    const run = await env.api.runBilling(sub.id);
    return settle(env, { subscription: run.body.subscription, charge: env.provider.lastCall() }, 'failed');
  },
};

describe('Lifecycle: every valid transition happens given the right trigger', () => {
  const env = useTestEnvironment();

  it('covers every transition in the diagram via API/billing', () => {
    expect(Object.keys(VIA_API_AND_BILLING).sort()).toEqual([...DIAGRAM].sort());
  });

  it.each(Object.entries(VIA_API_AND_BILLING))('E1 via API/billing: %s', async (transition, drive) => {
    const id = await drive(env());

    const [, to] = transition.split('->');
    expect((await env().assert.expectConsistent(id)).status).toBe(to);
    expect(env().assert.transitionsOf(id).at(-1)).toBe(transition);
  });

  it.each(Object.entries(VIA_WEBHOOK))('E1 via webhook: %s', async (transition, drive) => {
    const id = await drive(env());

    const [, to] = transition.split('->');
    expect((await env().assert.expectConsistent(id)).status).toBe(to);
    const last = env().db.auditLog(id).at(-1)!;
    expect(`${last.from_status}->${last.to_status}`).toBe(transition);
    expect(last.source).toBe('webhook');
  });
});

describe('Lifecycle: billing rules', () => {
  const env = useTestEnvironment();

  it('C1: basic trial ends with a declined charge -> past_due, failure recorded, no success record', async () => {
    const sub = await env().given.trialingSubscription('basic');
    env().clock.advanceDays(14);
    env().provider.willDecline();

    const res = await env().api.runBilling(sub.id);

    expect(res.body.result).toBe('declined');
    expect((await env().assert.expectConsistent(sub.id)).status).toBe('past_due');
    expect(env().db.invoicesFor(sub.id)).toEqual([expect.objectContaining({ amount: 1900, status: 'failed' })]);
    expect(env().db.attemptsFor(sub.id).map((a) => a.status)).toEqual(['failed']);
  });

  it('C2: an active renewal that is declined -> past_due; the earlier paid invoice is untouched', async () => {
    const sub = await env().given.activeSubscription();
    env().clock.advanceDays(30);
    env().provider.willDecline();

    await env().api.runBilling(sub.id);

    expect((await env().assert.expectConsistent(sub.id)).status).toBe('past_due');
    expect(env().db.invoicesFor(sub.id).map((i) => i.status)).toEqual(['paid', 'failed']);
  });

  it('an active renewal that succeeds keeps the subscription active and extends the period', async () => {
    const sub = await env().given.activeSubscription();
    env().clock.advanceDays(30);
    env().provider.willSucceed();

    await env().api.runBilling(sub.id);

    const view = await env().assert.expectConsistent(sub.id);
    expect(view.status).toBe('active');
    expect(Date.parse(view.current_period_end!)).toBeGreaterThan(Date.parse(sub.current_period_end!));
    expect(env().db.invoicesFor(sub.id).map((i) => i.status)).toEqual(['paid', 'paid']);
    expect(env().assert.transitionsOf(sub.id)).toEqual(['∅->trialing', 'trialing->active']);
  });

  it('an active subscription is not billed again before its period ends', async () => {
    const sub = await env().given.activeSubscription();
    env().clock.advanceDays(29);

    const res = await env().api.runBilling(sub.id);

    expect(res.body.error?.code).toBe('not_due');
  });

  it('C3: a successful retry reactivates and resets the retry count', async () => {
    const sub = await env().given.pastDueAfterRetries(1);
    expect(sub.retry_count).toBe(1);
    env().provider.willSucceed();

    await env().api.runBilling(sub.id);

    const view = await env().assert.expectConsistent(sub.id);
    expect(view).toMatchObject({ status: 'active', retry_count: 0 });
    expect(env().db.attemptsFor(sub.id).map((a) => [a.attempt_no, a.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'succeeded'],
    ]);
    expect(env().db.invoicesFor(sub.id).map((i) => i.status)).toEqual(['paid']);
    expect(env().notifier.activationsFor(sub.id)).toBe(1);
  });

  it('C4: three failed retries cancel the subscription, and billing stops', async () => {
    const sub = await env().given.pastDueAfterRetries(2);
    env().provider.willDecline();

    await env().api.runBilling(sub.id);
    const after = await env().api.runBilling(sub.id);

    const view = await env().assert.expectConsistent(sub.id);
    expect(view).toMatchObject({ status: 'canceled', retry_count: 3 });
    expect(view.canceled_at).not.toBeNull();
    expect(after.body.error?.code).toBe('subscription_canceled');
    // 1 signup charge + exactly 3 retries, then never again.
    expect(env().provider.calls).toHaveLength(4);
    expect(env().db.query('SELECT trigger FROM subscription_audit_log ORDER BY id DESC LIMIT 1')).toEqual([
      { trigger: 'RETRIES_EXHAUSTED' },
    ]);
  });
});

describe('Lifecycle: invalid transitions via the API are rejected', () => {
  const env = useTestEnvironment();

  it('a past_due subscription cannot be canceled via the API (not in the diagram) -> 409', async () => {
    const sub = await env().given.pastDueSubscription();
    const before = env().db.snapshotCounts();

    const res = await env().api.cancel(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('invalid_transition');
    expect((await env().assert.expectConsistent(sub.id)).status).toBe('past_due');
    expect(env().db.snapshotCounts()).toEqual(before);
  });

  it('E5: a canceled subscription cannot be billed back to active', async () => {
    const sub = await env().given.trialingSubscription('basic');
    await env().api.cancel(sub.id);
    env().clock.advanceDays(14);

    const res = await env().api.runBilling(sub.id);

    expect(res.status).toBe(409);
    expect((await env().assert.expectConsistent(sub.id)).status).toBe('canceled');
    expect(env().provider.calls).toHaveLength(0);
  });
});
