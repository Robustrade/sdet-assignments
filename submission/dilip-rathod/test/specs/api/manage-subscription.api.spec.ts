import { describe, expect, it } from 'vitest';
import { InvoiceListContract } from '../../support/api/contracts';
import { expectError, expectStatus, parseContract } from '../../support/api/HttpClient';
import { expectCharges, expectNoCharges, expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('GET /subscriptions/{id}', () => {
  const env = useTestEnvironment();

  it('404 subscription_not_found for an unknown id', async () => {
    expectError(await env().api.getSubscription('sub_nope'), 404, 'subscription_not_found');
  });

  it('returns the same representation as creation, plus the latest invoice once billed', async () => {
    const created = await env().given.trialing();
    expect(await env().api.get(created.id)).toEqual(created);

    const active = await env().given.active();
    const invoices = await env().api.invoices(active.id);
    expect(active.latest_invoice).toEqual({ id: invoices[0].id, amount: 4900, currency: 'USD', status: 'paid' });
  });

  it('lists invoices under the invoice-list contract', async () => {
    const active = await env().given.active();
    const res = await env().api.listInvoices(active.id);
    expectStatus(res, 200);
    const { data } = parseContract(InvoiceListContract, res, 'InvoiceList');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ subscription_id: active.id, plan: 'pro', amount: 4900, status: 'paid' });
  });

  it('404 when listing invoices of an unknown subscription', async () => {
    expectError(await env().api.listInvoices('sub_nope'), 404, 'subscription_not_found');
  });
});

describe('POST /subscriptions/{id}/cancel', () => {
  const env = useTestEnvironment();

  it('cancels a trialing subscription immediately and unschedules billing', async () => {
    const sub = await env().given.trialing();

    const canceled = await env().api.cancel(sub.id);

    expect(canceled).toMatchObject({ status: 'canceled', cancel_reason: 'customer_request', next_billing_at: null, canceled_at: env().clock.iso() });
    await expectSubscriptionState(env(), sub.id, { status: 'canceled', history: ['∅->trialing', 'trialing->canceled'] });
    expect(env().db.notificationsFor(sub.id).map((n) => n.kind)).toEqual(['subscription_canceled']);
  });

  it('409 invalid_transition when canceling twice, without touching persisted state', async () => {
    const sub = await env().given.canceled();
    const rowBefore = env().db.subscription(sub.id);
    const countsBefore = env().db.counts();
    env().clock.advanceMinutes(5);

    expectError(await env().api.cancelSubscription(sub.id), 409, 'invalid_transition');

    expect(env().db.subscription(sub.id)).toEqual(rowBefore);
    expectRowDeltas(countsBefore, env().db.counts());
  });

  it('404 for an unknown subscription', async () => {
    expectError(await env().api.cancelSubscription('sub_nope'), 404, 'subscription_not_found');
  });

  it('stops all future billing', async () => {
    const active = await env().given.active();
    await env().api.cancel(active.id);
    const chargesSoFar = env().provider.callCount;

    for (let month = 0; month < 12; month++) {
      env().clock.advanceDays(30);
      expect(await env().api.runBilling()).toEqual([]);
    }

    expect(env().provider.callCount).toBe(chargesSoFar);
    await expectSubscriptionState(env(), active.id, { status: 'canceled', invoices: ['paid'] });
  });
});

describe('POST /subscriptions/{id}/plan', () => {
  const env = useTestEnvironment();

  it('a plan change during trial is billed at the new plan price when the trial ends', async () => {
    const sub = await env().given.trialing();

    const changed = await env().api.changePlan(sub.id, 'basic');
    expect(changed).toMatchObject({ plan: 'basic', status: 'trialing', trial_ends_at: sub.trial_ends_at });
    expectNoCharges(env().provider);

    await env().given.billAt(sub.next_billing_at!);

    expectCharges(env().provider, [{ amount: 1900, currency: 'USD' }]);
    expect(env().db.invoicesFor(sub.id)).toMatchObject([{ plan: 'basic', amount: 1900, status: 'paid' }]);
    expect(env().db.auditTrail(sub.id).find((e) => e.event_type === 'plan_changed')).toMatchObject({ detail: 'pro->basic' });
  });

  it('a plan change on an active subscription applies from the next renewal, not retroactively', async () => {
    const active = await env().given.active('basic');
    await env().api.changePlan(active.id, 'pro');

    await env().given.billAt(active.next_billing_at!);

    expectCharges(env().provider, [{ amount: 1900 }, { amount: 4900 }]);
    expect(env().db.invoicesFor(active.id).map((i) => [i.plan, i.amount])).toEqual([['basic', 1900], ['pro', 4900]]);
  });

  it.each([
    ['canceled', 409, 'plan_change_not_allowed'],
    ['past_due', 409, 'plan_change_not_allowed'],
  ] as const)('rejects a plan change on a %s subscription', async (state, status, code) => {
    const id = state === 'canceled' ? (await env().given.canceled()).id : (await env().given.pastDue()).subscription.id;
    const before = env().db.subscription(id);

    expectError(await env().api.changePlanRequest(id, { plan: 'basic' }), status, code);

    expect(env().db.subscription(id)).toEqual(before);
  });

  it('409 plan_unchanged / 422 unknown_plan / 400 validation_error', async () => {
    const sub = await env().given.trialing();
    expectError(await env().api.changePlanRequest(sub.id, { plan: 'pro' }), 409, 'plan_unchanged');
    expectError(await env().api.changePlanRequest(sub.id, { plan: 'platinum' }), 422, 'unknown_plan');
    expectError(await env().api.changePlanRequest(sub.id, {}), 400, 'validation_error');
    await expectSubscriptionState(env(), sub.id, { status: 'trialing', plan: 'pro' });
  });
});
