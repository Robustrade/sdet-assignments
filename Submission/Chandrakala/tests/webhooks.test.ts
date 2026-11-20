import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingHarness } from './support/harness.ts';
import { SubscriptionBuilder, WebhookBuilder } from './support/builders.ts';
import type { WebhookType } from '../src/domain.ts';

describe('signed webhook delivery, idempotency and ordering', () => {
  let h: BillingHarness;
  beforeEach(async () => { h = new BillingHarness(); await h.start(); });
  afterEach(async () => { await h.close(); });

  it('applies one event once and records both deliveries without duplicate side effects', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build();
    const first = await h.webhooks.deliver(event);
    assert.deepEqual(first,{status:200,body:{outcome:'applied'}});
    await h.verify.state(s.id,'active');
    const before = h.verify.financialSnapshot(s.id);
    assert.deepEqual(await h.webhooks.deliver(event),{status:200,body:{outcome:'duplicate'}});
    h.verify.unchanged(s.id,before);
    assert.equal(h.repo.events(s.id).length,1);
    assert.deepEqual(h.repo.deliveries(s.id).map(d => d.outcome),['applied','duplicate']);
    assert.equal(h.repo.payments(s.id).length,1); h.verify.charge(invoice);
  });

  it('ignores the same financial success with a different event ID', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    await h.webhooks.deliver(new WebhookBuilder(invoice).build());
    const before = h.verify.financialSnapshot(s.id);
    assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).build())).body.outcome,'ignored');
    h.verify.unchanged(s.id,before); assert.equal(h.repo.events(s.id).length,2);
    await h.verify.state(s.id,'active');
  });

  it('does not regress paid invoice or active subscription after a late failure', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    await h.webhooks.deliver(new WebhookBuilder(invoice).build());
    const before = h.verify.financialSnapshot(s.id); h.clock.advanceDays(1);
    const response = await h.webhooks.deliver(new WebhookBuilder(invoice).ofType('payment.failed').build());
    assert.equal(response.body.outcome,'ignored'); h.verify.unchanged(s.id,before);
    assert.deepEqual(h.repo.payments(s.id).map(p => p.status),['succeeded']);
    await h.verify.state(s.id,'active');
  });

  it('records a failure then recovers the same invoice on later success', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).ofType('payment.failed').build())).status,200);
    await h.verify.state(s.id,'past_due');
    assert.equal(h.repo.subscription(s.id)?.failures,1);
    await h.webhooks.deliver(new WebhookBuilder(invoice).build());
    await h.verify.state(s.id,'active');
    assert.deepEqual(h.repo.payments(s.id).map(p => p.status),['failed','succeeded']);
    assert.equal(h.repo.subscription(s.id)?.failures,0); h.verify.charge(invoice);
  });

  it('a duplicate failure with another event ID does not consume a retry', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    await h.webhooks.deliver(new WebhookBuilder(invoice).ofType('payment.failed').build());
    const before = h.verify.financialSnapshot(s.id);
    assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).ofType('payment.failed').build())).body.outcome,'ignored');
    h.verify.unchanged(s.id,before); await h.verify.state(s.id,'past_due');
  });

  it('a recurring failure webhook moves active to past_due without a provider charge', async () => {
    const {body} = await h.create('pro'); const id = body.subscription.id;
    h.clock.advanceDays(30); h.provider.timeout();
    const billed = await h.api.bill(id); assert.ok(billed.body.invoice);
    await h.verify.state(id,'active');
    await h.webhooks.deliver(new WebhookBuilder(billed.body.invoice).ofType('payment.failed').build());
    await h.verify.state(id,'past_due');
    assert.equal(h.provider.calls.length,2);
  });

  it('late failure on an older invoice does not regress a newer successful renewal', async () => {
    h.provider.decline(); const {body} = await h.create('pro');
    const id = body.subscription.id; assert.ok(body.invoice);
    h.provider.succeed(); await h.api.bill(id); await h.verify.state(id,'active');
    const before = h.verify.financialSnapshot(id);
    await h.webhooks.deliver(new WebhookBuilder(body.invoice).ofType('payment.failed').build());
    h.verify.unchanged(id,before); await h.verify.state(id,'active');
  });

  it('late success on an older failed invoice cannot override a newer failure', async () => {
    h.provider.decline(); const {body} = await h.create('pro');
    const id = body.subscription.id; assert.ok(body.invoice);
    await h.api.bill(id); assert.equal(h.repo.subscription(id)?.failures,2);
    await h.webhooks.deliver(new WebhookBuilder(body.invoice).build());
    assert.equal(h.repo.invoice(body.invoice.id)?.status,'paid');
    assert.equal(h.repo.subscription(id)?.failures,2);
    assert.equal(h.repo.invoices(id).at(-1)?.status,'failed');
    await h.verify.state(id,'past_due');
  });

  for (const type of ['payment.succeeded','payment.failed'] as WebhookType[]) {
    it(`cannot leave canceled via ${type}`, async () => {
      const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
      await h.api.cancel(s.id); await h.webhooks.deliver(new WebhookBuilder(invoice).ofType(type).build());
      await h.verify.state(s.id,'canceled');
      assert.equal((await h.api.bill(s.id)).status,409); assert.equal(h.provider.calls.length,1);
    });
  }

  it('refunds a paid invoice once while preserving successful payment history', async () => {
    const {body} = await h.create('pro'); const id = body.subscription.id; assert.ok(body.invoice);
    const refund = new WebhookBuilder(body.invoice).ofType('payment.refunded').build();
    assert.equal((await h.webhooks.deliver(refund)).body.outcome,'applied');
    assert.equal(h.repo.invoice(body.invoice.id)?.status,'refunded');
    assert.deepEqual(h.repo.payments(id).map(p => p.status),['succeeded','refunded']);
    const before = h.verify.financialSnapshot(id);
    await h.webhooks.deliver(refund);
    await h.webhooks.deliver(new WebhookBuilder(body.invoice).build());
    h.verify.unchanged(id,before); await h.verify.state(id,'active');
  });

  it('ignores a refund before any successful payment', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const before = h.verify.financialSnapshot(s.id);
    assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).ofType('payment.refunded').build())).body.outcome,'ignored');
    h.verify.unchanged(s.id,before); await h.verify.state(s.id,'trialing');
  });

  for (const signature of [null,'invalid','0'.repeat(64)]) {
    it(`rejects absent or forged signature: ${signature?.slice(0,8) ?? 'absent'}`, async () => {
      const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
      const before = h.repo.counts();
      const response = await h.webhooks.raw(JSON.stringify(new WebhookBuilder(invoice).build()),signature);
      assert.equal(response.status,401); assert.deepEqual(h.repo.counts(),before);
      await h.verify.state(s.id,'trialing'); assert.equal(h.provider.calls.length,1);
    });
  }

  it('validates raw bytes, not a reserialized version of the body', async () => {
    const {invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build();
    const compact = JSON.stringify(event); const pretty = JSON.stringify(event,null,2);
    assert.equal((await h.webhooks.raw(pretty,h.webhooks.sign(compact))).status,401);
    assert.equal((await h.webhooks.raw(pretty)).status,200);
  });

  for (const raw of ['{','null','[]','{}','{"type":"unknown"}']) {
    it(`rejects signed malformed webhook ${raw}`, async () => {
      const before = h.repo.counts(); assert.equal((await h.webhooks.raw(raw)).status,400);
      assert.deepEqual(h.repo.counts(),before); assert.equal(h.provider.calls.length,0);
    });
  }

  for (const patch of [{amount:0},{amount:1.5},{currency:'EUR'},{event_id:''}]) {
    it(`rejects invalid event fields ${JSON.stringify(patch)}`, async () => {
      const {invoice} = await h.pendingTrial(); assert.ok(invoice); const before = h.repo.counts();
      assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).with(patch).build())).status,400);
      assert.deepEqual(h.repo.counts(),before);
    });
  }

  for (const [patch,status] of [
    [{amount:999},409], [{invoice_id:'missing'},404], [{subscription_id:'missing'},404],
  ] as const) {
    it(`rejects conflicting webhook reference ${JSON.stringify(patch)}`, async () => {
      const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
      const before = h.verify.financialSnapshot(s.id); const counts = h.repo.counts();
      assert.equal((await h.webhooks.deliver(new WebhookBuilder(invoice).with(patch).build())).status,status);
      h.verify.unchanged(s.id,before); assert.deepEqual(h.repo.counts(),counts);
    });
  }

  it('rejects an invoice belonging to a different subscription', async () => {
    const first = await h.pendingTrial(); assert.ok(first.invoice);
    const second = await h.api.create(new SubscriptionBuilder().with({customer_id:'cust_002'}).build());
    const counts = h.repo.counts();
    const event = new WebhookBuilder(first.invoice).with({subscription_id:second.body.subscription.id}).build();
    assert.equal((await h.webhooks.deliver(event)).status,409);
    assert.deepEqual(h.repo.counts(),counts);
  });

  it('rejects an event ID reused with different content', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build(); await h.webhooks.deliver(event);
    const before = h.repo.counts();
    assert.equal((await h.webhooks.deliver({...event,type:'payment.failed'})).status,409);
    assert.deepEqual(h.repo.counts(),before); await h.verify.state(s.id,'active');
  });

  it('parallel duplicate deliveries commit exactly one financial effect', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build();
    const results = await Promise.all([h.webhooks.deliver(event),h.webhooks.deliver(event)]);
    assert.deepEqual(results.map(r => r.status),[200,200]);
    assert.deepEqual(results.map(r => r.body.outcome).sort(),['applied','duplicate']);
    assert.equal(h.repo.invoices(s.id).length,1); assert.equal(h.repo.payments(s.id).length,1);
    assert.equal(h.repo.events(s.id).length,1); assert.equal(h.repo.deliveries(s.id).length,2);
    h.verify.charge(invoice); await h.verify.state(s.id,'active');
  });
});
