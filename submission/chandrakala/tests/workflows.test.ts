import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingHarness } from './support/harness.ts';
import { WebhookBuilder } from './support/builders.ts';

describe('billing workflows and provider interaction', () => {
  let h: BillingHarness;
  beforeEach(async () => { h = new BillingHarness(); await h.start(); });
  afterEach(async () => { await h.close(); });

  it('trial -> past_due -> active -> canceled agrees with API, DB and provider at each stage', async () => {
    const {body} = await h.create(); const id = body.subscription.id;
    await h.verify.state(id,'trialing'); h.clock.advanceDays(7); h.provider.decline();
    const failed = await h.api.bill(id);
    assert.equal(failed.status,200); assert.equal(failed.body.invoice?.status,'failed');
    assert.equal(h.repo.payments(id).some(p => p.status === 'succeeded'),false);
    h.verify.charge(failed.body.invoice!); await h.verify.state(id,'past_due');
    h.provider.succeed(); h.clock.advanceDays(1);
    const recovered = await h.api.bill(id);
    h.verify.charge(recovered.body.invoice!,2); await h.verify.state(id,'active');
    assert.equal(h.repo.subscription(id)?.failures,0);
    assert.notEqual(recovered.body.invoice?.id,failed.body.invoice?.id);
    assert.equal((await h.api.cancel(id)).status,200);
    assert.equal(h.provider.calls.length,2); await h.verify.state(id,'canceled');
    const before = h.verify.financialSnapshot(id);
    assert.equal((await h.api.bill(id)).status,409);
    assert.equal((await h.api.cancel(id)).status,409);
    assert.equal((await h.api.changePlan(id,'pro')).status,409);
    h.verify.unchanged(id,before);
  });

  it('cancels a trial without charging and refuses subsequent billing', async () => {
    const {body} = await h.create(); const id = body.subscription.id;
    assert.equal((await h.api.cancel(id)).status,200); await h.verify.state(id,'canceled');
    h.clock.advanceDays(8);
    assert.equal((await h.api.bill(id)).status,409);
    assert.equal(h.provider.calls.length,0); assert.equal(h.repo.invoices(id).length,0);
  });

  it('moves active -> past_due on recurring decline, then cancels after three failed attempts', async () => {
    const {body} = await h.create('pro'); const id = body.subscription.id;
    await h.verify.state(id,'active'); h.provider.decline();
    for (let failure = 1; failure <= 3; failure++) {
      h.clock.advanceDays(1);
      const result = await h.api.bill(id);
      assert.equal(result.body.invoice?.status,'failed');
      h.verify.charge(result.body.invoice!,failure + 1);
      assert.equal(result.body.subscription.failures,failure);
      await h.verify.state(id,failure === 3 ? 'canceled' : 'past_due');
      if (failure === 1) {
        const before = h.verify.financialSnapshot(id);
        assert.equal((await h.api.cancel(id)).status,409);
        assert.equal((await h.api.changePlan(id,'basic')).status,409);
        h.verify.unchanged(id,before);
      }
    }
    assert.equal(new Set(h.provider.calls.map(c => c.idempotencyKey)).size,4);
    const before = h.verify.financialSnapshot(id);
    assert.equal((await h.api.bill(id)).status,409); h.verify.unchanged(id,before);
  });

  it('immediate decline creates a past_due subscription, never a success record', async () => {
    h.provider.decline(); const {status,body} = await h.create('pro');
    assert.equal(status,201); assert.equal(body.invoice?.status,'failed');
    assert.deepEqual(h.repo.payments(body.subscription.id).map(p => p.status),['failed']);
    h.verify.charge(body.invoice!); await h.verify.state(body.subscription.id,'past_due');
  });

  it('keeps timeout pending, avoids blind recharge, and resolves from a success webhook', async () => {
    h.provider.timeout(); const result = await h.create('pro');
    assert.equal(result.status,202);
    const {subscription:s,invoice} = result.body;
    assert.ok(invoice); assert.equal(invoice.status,'pending'); await h.verify.state(s.id,'trialing');
    h.verify.charge(invoice);
    const retry = await h.api.bill(s.id);
    assert.equal(retry.status,202); assert.equal(retry.body.invoice?.id,invoice.id);
    assert.equal(h.provider.calls.length,1); assert.equal(h.repo.payments(s.id).length,0);
    h.clock.advanceDays(1);
    const event = new WebhookBuilder(invoice).build();
    assert.deepEqual(await h.webhooks.deliver(event),{status:200,body:{outcome:'applied'}});
    assert.equal(h.provider.calls.length,1); await h.verify.state(s.id,'active');
  });

  it('records a late settlement after cancellation without reactivation', async () => {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    await h.api.cancel(s.id); await h.verify.state(s.id,'canceled');
    h.clock.advanceDays(1);
    const response = await h.webhooks.deliver(new WebhookBuilder(invoice).build());
    assert.equal(response.body.outcome,'applied');
    assert.equal(h.repo.invoice(invoice.id)?.status,'paid');
    assert.equal(h.provider.calls.length,1); await h.verify.state(s.id,'canceled');
  });

  it('does not duplicate a reserved attempt while a provider request is in flight', async () => {
    const {body} = await h.create(); const id = body.subscription.id; h.clock.advanceDays(7);
    let resolveCharge!: (value:'success') => void;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    h.provider.handler = async () => {
      signalStarted(); return new Promise(resolve => { resolveCharge = resolve; });
    };
    const first = h.api.bill(id); await started;
    const second = await h.api.bill(id);
    assert.equal(second.status,202); assert.equal(h.provider.calls.length,1);
    resolveCharge('success');
    const settled = await first;
    assert.equal(settled.status,200); assert.equal(settled.body.invoice?.id,second.body.invoice?.id);
    assert.equal(h.repo.invoices(id).length,1); await h.verify.state(id,'active');
  });

  it('unexpected provider exceptions return 500 without inventing a payment success', async () => {
    h.provider.handler = async () => { throw new Error('Provider integration bug'); };
    const response = await h.create('pro'); assert.equal(response.status,500);
    const invoiceId = h.provider.calls[0]!.invoiceId;
    const invoice = h.repo.invoice(invoiceId)!;
    assert.equal(invoice.status,'pending');
    assert.equal(h.repo.payments(invoice.subscription_id).length,0);
    await h.verify.state(invoice.subscription_id,'trialing');
  });
});
