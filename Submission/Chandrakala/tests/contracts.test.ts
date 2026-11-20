import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingHarness } from './support/harness.ts';
import { SubscriptionBuilder } from './support/builders.ts';
import type { CreateSubscription } from '../src/domain.ts';

describe('API contracts and plan behavior', () => {
  let h: BillingHarness;
  beforeEach(async () => { h = new BillingHarness(); await h.start(); });
  afterEach(async () => { await h.close(); });

  it('creates a seven-day Basic trial without a provider call', async () => {
    const response = await h.create();
    assert.equal(response.status, 201); assert.equal(response.body.invoice, null);
    const s = response.body.subscription;
    assert.match(s.id, /^sub_/);
    assert.deepEqual({...s, id: 'generated'}, {
      id:'generated', customer_id:'cust_001', payment_method_id:'pm_test_visa_4242',
      plan:'basic', status:'trialing', trial_end:'2026-01-08T12:00:00.000Z', failures:0,
      created_at:'2026-01-01T12:00:00.000Z', updated_at:'2026-01-01T12:00:00.000Z',
    });
    assert.equal(h.provider.calls.length, 0);
    assert.equal(h.repo.counts().invoices, 0);
    await h.verify.state(s.id, 'trialing');
  });

  it('charges Pro immediately for exactly 4900 cents and persists success', async () => {
    const response = await h.create('pro');
    assert.equal(response.status, 201);
    const {subscription: s, invoice} = response.body;
    assert.ok(invoice); assert.match(invoice.id, /^inv_/);
    assert.equal(s.trial_end, s.created_at);
    assert.deepEqual({...invoice, id:'generated'}, {
      id:'generated', subscription_id:s.id, sequence:1, amount:4900,
      currency:'USD', status:'paid', created_at:s.created_at, updated_at:s.created_at,
    });
    h.verify.charge(invoice);
    assert.equal(h.repo.payments(s.id)[0]?.status, 'succeeded');
    await h.verify.state(s.id, 'active');
  });

  const invalid: [Partial<CreateSubscription>, number][] = [
    [{plan:'unknown'},400], [{plan:''},400], [{customer_id:''},400],
    [{customer_id:undefined},400], [{payment_method_id:''},400],
    [{payment_method_id:'invalid'},400], [{payment_method_id:undefined},400],
    [{customer_id:'unknown'},404], [{plan:undefined},400],
  ];
  for (const [overrides, status] of invalid) {
    it(`rejects ${JSON.stringify(overrides)} without writes or charges`, async () => {
      const before = h.repo.counts();
      const response = await h.api.create(new SubscriptionBuilder().with(overrides).build());
      assert.equal(response.status, status);
      assert.equal(typeof (response.body as unknown as {error:string}).error, 'string');
      assert.deepEqual(h.repo.counts(), before); assert.equal(h.provider.calls.length, 0);
    });
  }
  it('rejects malformed creation JSON without persistence', async () => {
    assert.equal((await h.api.malformedCreation()).status, 400);
    assert.equal(h.repo.counts().subscriptions, 0); assert.equal(h.provider.calls.length, 0);
  });
  for (const method of ['get','cancel','bill'] as const) {
    it(`returns 404 for unknown subscription: ${method}`, async () => {
      assert.equal((await h.api[method]('missing')).status, 404);
      assert.equal(h.repo.counts().subscriptions, 0); assert.equal(h.provider.calls.length, 0);
    });
  }
  it('rejects billing one millisecond before trial expiry and accepts the exact boundary', async () => {
    const {body} = await h.create(); const id = body.subscription.id;
    h.clock.advanceDays(7 - 1 / 86400000);
    const before = h.verify.financialSnapshot(id);
    assert.equal((await h.api.bill(id)).status, 409); h.verify.unchanged(id, before);
    h.clock.advanceDays(1 / 86400000);
    const billed = await h.api.bill(id);
    assert.equal(billed.status, 200); assert.equal(billed.body.invoice?.amount, 1900);
    h.verify.charge(billed.body.invoice!); await h.verify.state(id, 'active');
  });
  it('changes a trial plan without resetting the trial or charging', async () => {
    const {body} = await h.create(); const id = body.subscription.id;
    h.clock.advanceDays(2);
    const changed = await h.api.changePlan(id,'pro');
    assert.equal(changed.status, 200); assert.equal(changed.body.plan,'pro');
    assert.equal(changed.body.trial_end, body.subscription.trial_end);
    assert.equal(h.provider.calls.length, 0); await h.verify.state(id,'trialing');
    h.clock.advanceDays(5);
    const billed = await h.api.bill(id);
    assert.equal(billed.body.invoice?.amount,4900); h.verify.charge(billed.body.invoice!);
    await h.verify.state(id,'active');
  });
  it('applies active plan changes to future invoices, preserving old amounts', async () => {
    const {body} = await h.create('pro'); const id = body.subscription.id;
    assert.equal((await h.api.changePlan(id,'basic')).status,200);
    assert.equal(h.provider.calls.length,1); await h.verify.state(id,'active');
    h.clock.advanceDays(30);
    const billed = await h.api.bill(id);
    assert.deepEqual(h.repo.invoices(id).map(i => i.amount),[4900,1900]);
    h.verify.charge(billed.body.invoice!,2); await h.verify.state(id,'active');
  });
  it('rejects invalid and missing plan targets without side effects', async () => {
    const {body} = await h.create(); const id = body.subscription.id;
    const before = h.verify.financialSnapshot(id);
    assert.equal((await h.api.changePlan(id,'enterprise')).status,400);
    h.verify.unchanged(id,before);
    assert.equal((await h.api.changePlan('missing','basic')).status,404);
  });
  it('rejects plan changes while payment is unresolved', async () => {
    const {subscription:s} = await h.pendingTrial();
    const before = h.verify.financialSnapshot(s.id);
    assert.equal((await h.api.changePlan(s.id,'pro')).status,409);
    h.verify.unchanged(s.id,before);
  });
  it('returns structured errors for unknown routes and oversized requests', async () => {
    const missing = await h.api.http.send<{error:string}>('GET','/unknown');
    assert.deepEqual(missing,{status:404,body:{error:'Route not found'}});
    assert.equal((await h.api.http.send('POST','/subscriptions','x'.repeat(65537))).status,413);
    assert.equal(h.repo.counts().subscriptions,0);
  });
});
