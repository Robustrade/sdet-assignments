import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingHarness } from './support/harness.ts';
import { WebhookBuilder } from './support/builders.ts';

it('webhook transaction rolls back partial invoice, payment and audit writes on failure', async () => {
  const h = new BillingHarness(); await h.start();
  try {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build();
    const before = h.verify.financialSnapshot(s.id); const counts = h.repo.counts();
    const original = h.repo.recordEvent.bind(h.repo);
    h.repo.recordEvent = () => { throw new Error('Injected persistence outage after settlement'); };
    assert.equal((await h.webhooks.deliver(event)).status,500);
    h.verify.unchanged(s.id,before); assert.deepEqual(h.repo.counts(),counts);
    h.repo.recordEvent = original;
    assert.equal((await h.webhooks.deliver(event)).body.outcome,'applied');
    await h.verify.state(s.id,'active'); h.verify.charge(invoice);
  } finally { await h.close(); }
});

it('payment uniqueness is enforced by SQLite and failed transactions leave no residue', async () => {
  const h = new BillingHarness(); await h.start();
  try {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    assert.throws(() => h.repo.transaction(() => {
      h.repo.addPayment(invoice.id,'succeeded',h.clock.now().toISOString());
      h.repo.addPayment(invoice.id,'succeeded',h.clock.now().toISOString());
    }), /UNIQUE constraint failed/);
    assert.equal(h.repo.payments(s.id).length,0);
    await h.verify.state(s.id,'trialing');
  } finally { await h.close(); }
});

it('file-backed records and deduplication survive database close and reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(),'billing-assignment-'));
  const path = join(directory,'billing.sqlite');
  let h = new BillingHarness(path); await h.start();
  try {
    const {subscription:s,invoice} = await h.pendingTrial(); assert.ok(invoice);
    const event = new WebhookBuilder(invoice).build(); await h.webhooks.deliver(event);
    const counts = h.repo.counts(); const snapshot = h.verify.financialSnapshot(s.id);
    await h.close(); h = new BillingHarness(path); await h.start();
    assert.deepEqual(h.repo.counts(),counts);
    assert.deepEqual(h.repo.subscription(s.id),snapshot.subscription);
    assert.deepEqual(h.repo.invoices(s.id),snapshot.invoices);
    assert.deepEqual(h.repo.payments(s.id),snapshot.payments);
    assert.deepEqual(h.repo.audits(s.id),snapshot.audits);
    assert.equal((await h.webhooks.deliver(event)).body.outcome,'duplicate');
    assert.equal(h.repo.payments(s.id).length,1); assert.equal(h.repo.events(s.id).length,1);
    assert.equal(h.repo.deliveries(s.id).length,2); assert.equal(h.provider.calls.length,0);
    await h.verify.state(s.id,'active');
  } finally {
    await h.close(); await unlink(path); await rmdir(directory);
  }
});
