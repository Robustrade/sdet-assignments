import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingTestFixture } from '../src/fixture.ts';
import { SubscriptionTestDataBuilder, PaymentWebhookTestDataBuilder } from '../src/builders.ts';
import { PLANS, SubscriptionLifecycleStateMachine } from '../src/domain.ts';
import { sign } from '../src/http.ts';
type BillingFixture = Awaited<ReturnType<typeof createBillingTestFixture>>;
async function runIsolatedBillingScenario(fn: (fixture: BillingFixture) => Promise<void>) { const fixture = await createBillingTestFixture(); try { await fn(fixture); } finally { await fixture.close(); } }
async function createTestSubscription(fixture: BillingFixture, plan: 'basic'|'pro' = 'pro') { const r = await fixture.api.createSubscription(new SubscriptionTestDataBuilder().withPlan(plan).buildSubscriptionInput()); assert.equal(r.status, 201); return r.body; }
function createPendingInvoiceRecord(fixture: BillingFixture, subscriptionId: string, amount=4900) { const id = `inv_fixture_${fixture.db.invoices.size}`; const at = new Date().toISOString(); fixture.db.invoices.set(id,{id,subscriptionId,amount,currency:'USD',status:'pending',createdAt:at,updatedAt:at}); return id; }

test('create, retrieve, plan trial rules, persistence and no provider call', () => runIsolatedBillingScenario(async f => {
  for (const plan of ['basic','pro'] as const) { const s = await createTestSubscription(f,plan); assert.equal(s.status,'trialing'); assert.equal((await f.api.getSubscriptionById(s.id)).body.status,f.db.subscriptions.get(s.id)?.status); assert(Math.abs((Date.parse(s.trialEndsAt)-Date.parse(s.createdAt))/86400000-PLANS[plan].trialDays)<0.01); }
  assert.equal(f.provider.calls.length,0); assert.equal(f.db.audit.length,2);
}));
test('invalid customer/plan/payment method/missing field have no side effects', () => runIsolatedBillingScenario(async f => {
  for (const input of [new SubscriptionTestDataBuilder().withCustomerId('unknown').buildSubscriptionInput(),{...new SubscriptionTestDataBuilder().buildSubscriptionInput(),plan:'invalid'},new SubscriptionTestDataBuilder().withPaymentMethodId('bad').buildSubscriptionInput(),{plan:'pro'}]) assert.equal((await f.api.createSubscription(input)).status,422);
  assert.equal((await f.api.getSubscriptionById('missing')).status,404); assert.equal(f.db.subscriptions.size,0); assert.equal(f.provider.calls.length,0);
}));
test('provider success validates amount, customer, method, idempotency key, DB', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f); const r=await f.api.attemptSubscriptionCharge(s.id); assert.equal(r.body.subscription.status,'active'); assert.equal(r.body.invoice.status,'paid'); assert.equal(f.db.invoices.get(r.body.invoice.id)?.status,'paid');
  assert.deepEqual(f.provider.calls[0],{subscriptionId:s.id,invoiceId:r.body.invoice.id,customerId:'cust_001',paymentMethodId:'pm_test_visa_4242',amount:4900,currency:'USD',idempotencyKey:r.body.invoice.id}); assert.equal(f.provider.calls.length,1);
}));
test('trialing -> past_due -> active on declined charge then successful retry', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f); f.provider.outcome='decline'; const a=await f.api.attemptSubscriptionCharge(s.id); assert.equal(a.body.subscription.status,'past_due'); assert.equal(a.body.invoice.status,'failed'); f.provider.outcome='success'; const b=await f.api.attemptSubscriptionCharge(s.id); assert.equal(b.body.subscription.status,'active'); assert.equal(b.body.invoice.status,'paid'); assert.equal(f.provider.calls.length,2);
}));
test('active -> past_due -> canceled and no further billing', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f); await f.api.attemptSubscriptionCharge(s.id); f.provider.outcome='decline'; assert.equal((await f.api.attemptSubscriptionCharge(s.id)).body.subscription.status,'past_due'); assert.equal((await f.api.markSubscriptionRetriesExhausted(s.id)).body.status,'canceled'); assert.equal((await f.api.attemptSubscriptionCharge(s.id)).status,409); assert.equal(f.provider.calls.length,2);
}));
test('trialing and active cancellation; duplicate cancellation rejected', () => runIsolatedBillingScenario(async f => {
  const a=await createTestSubscription(f); assert.equal((await f.api.cancelSubscription(a.id)).body.status,'canceled'); assert.equal((await f.api.cancelSubscription(a.id)).status,409); const b=await createTestSubscription(f); await f.api.attemptSubscriptionCharge(b.id); assert.equal((await f.api.cancelSubscription(b.id)).body.status,'canceled');
}));
test('webhook applies once, duplicate event recorded without invoice/provider duplication', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f), id=createPendingInvoiceRecord(f,s.id), event=new PaymentWebhookTestDataBuilder(s.id,id).withEventId('evt_replay').buildPaymentWebhook(); assert.equal((await f.api.sendPaymentWebhook(event)).body.disposition,'applied'); assert.equal((await f.api.sendPaymentWebhook(event)).body.disposition,'duplicate'); assert.equal(f.db.webhookEvents.size,1); assert.equal(f.db.webhookDeliveries.length,2); assert.equal(f.db.invoices.size,1); assert.equal(f.provider.calls.length,0); assert.equal(f.db.audit.filter(x=>x.reason==='charge_success').length,1);
}));
test('failed webhook then success; stale failure cannot regress paid invoice', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f), id=createPendingInvoiceRecord(f,s.id); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id).withEventType('payment.failed').buildPaymentWebhook())).body.disposition,'applied'); assert.equal(f.db.subscriptions.get(s.id)?.status,'past_due'); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id).buildPaymentWebhook())).body.disposition,'applied'); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id).withEventType('payment.failed').buildPaymentWebhook())).body.disposition,'ignored'); assert.equal(f.db.subscriptions.get(s.id)?.status,'active'); assert.equal(f.db.invoices.get(id)?.status,'paid');
}));
test('canceled -> active webhook impossible', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f),id=createPendingInvoiceRecord(f,s.id); await f.api.cancelSubscription(s.id); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id).buildPaymentWebhook())).body.disposition,'ignored'); assert.equal(f.db.subscriptions.get(s.id)?.status,'canceled'); assert.equal(f.db.invoices.get(id)?.status,'pending');
}));
test('forged signature, malformed signed JSON/schema and mismatched amount rejected', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f),id=createPendingInvoiceRecord(f,s.id); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id).buildPaymentWebhook(),'0'.repeat(64))).status,401); const raw='{bad'; assert.equal((await f.api.sendApiRequest('POST','/webhooks/payment-provider',raw,{'x-provider-signature':sign(raw,f.secret)})).status,400); const malformed=JSON.stringify({event_id:'bad'}); assert.equal((await f.api.sendApiRequest('POST','/webhooks/payment-provider',malformed,{'x-provider-signature':sign(malformed,f.secret)})).status,400); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,id,1).buildPaymentWebhook())).status,422); assert.equal(f.db.webhookEvents.size,0); assert.equal(f.db.invoices.get(id)?.status,'pending');
}));
test('provider timeout keeps pending/unknown; no false success', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f); f.provider.outcome='timeout'; const r=await f.api.attemptSubscriptionCharge(s.id); assert.equal(r.body.outcome,'unknown'); assert.equal(r.body.invoice.status,'pending'); assert.equal(f.db.subscriptions.get(s.id)?.status,'trialing'); assert.equal(f.provider.calls.length,1);
}));
test('refund persists without inventing lifecycle transition', () => runIsolatedBillingScenario(async f => {
  const s=await createTestSubscription(f),r=await f.api.attemptSubscriptionCharge(s.id); assert.equal((await f.api.sendPaymentWebhook(new PaymentWebhookTestDataBuilder(s.id,r.body.invoice.id).withEventType('payment.refunded').buildPaymentWebhook())).body.disposition,'applied'); assert.equal(f.db.invoices.get(r.body.invoice.id)?.status,'refunded'); assert.equal(f.db.subscriptions.get(s.id)?.status,'active');
}));
test('explicit state machine disallows multiple illegal transitions', () => { const machine=new SubscriptionLifecycleStateMachine(); assert.equal(machine.getNextStatus('canceled','charge_success'),null); assert.equal(machine.getNextStatus('active','charge_success'),null); assert.equal(machine.getNextStatus('trialing','retry_exhausted'),null); assert.equal(machine.getNextStatus('past_due','cancel'),null); });
