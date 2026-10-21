import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture } from '../src/fixture.ts';
import { SubscriptionBuilder, WebhookBuilder } from '../src/builders.ts';
import { PLANS, SubscriptionStateMachine } from '../src/domain.ts';
import { sign } from '../src/http.ts';
type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function scenario(fn: (f: Fixture) => Promise<void>) { const f = await makeFixture(); try { await fn(f); } finally { await f.close(); } }
async function create(f: Fixture, plan: 'basic'|'pro' = 'pro') { const r = await f.api.create(new SubscriptionBuilder().withPlan(plan).build()); assert.equal(r.status, 201); return r.body; }
function pending(f: Fixture, sub: string, amount=4900) { const id = `inv_fixture_${f.db.invoices.size}`; const at = new Date().toISOString(); f.db.invoices.set(id,{id,subscriptionId:sub,amount,currency:'USD',status:'pending',createdAt:at,updatedAt:at}); return id; }

test('create, retrieve, plan trial rules, persistence and no provider call', () => scenario(async f => {
  for (const plan of ['basic','pro'] as const) { const s = await create(f,plan); assert.equal(s.status,'trialing'); assert.equal((await f.api.get(s.id)).body.status,f.db.subscriptions.get(s.id)?.status); assert(Math.abs((Date.parse(s.trialEndsAt)-Date.parse(s.createdAt))/86400000-PLANS[plan].trialDays)<0.01); }
  assert.equal(f.provider.calls.length,0); assert.equal(f.db.audit.length,2);
}));
test('invalid customer/plan/payment method/missing field have no side effects', () => scenario(async f => {
  for (const input of [new SubscriptionBuilder().withCustomer('unknown').build(),{...new SubscriptionBuilder().build(),plan:'invalid'},new SubscriptionBuilder().withPaymentMethod('bad').build(),{plan:'pro'}]) assert.equal((await f.api.create(input)).status,422);
  assert.equal((await f.api.get('missing')).status,404); assert.equal(f.db.subscriptions.size,0); assert.equal(f.provider.calls.length,0);
}));
test('provider success validates amount, customer, method, idempotency key, DB', () => scenario(async f => {
  const s=await create(f); const r=await f.api.bill(s.id); assert.equal(r.body.subscription.status,'active'); assert.equal(r.body.invoice.status,'paid'); assert.equal(f.db.invoices.get(r.body.invoice.id)?.status,'paid');
  assert.deepEqual(f.provider.calls[0],{subscriptionId:s.id,invoiceId:r.body.invoice.id,customerId:'cust_001',paymentMethodId:'pm_test_visa_4242',amount:4900,currency:'USD',idempotencyKey:r.body.invoice.id}); assert.equal(f.provider.calls.length,1);
}));
test('trialing -> past_due -> active on declined charge then successful retry', () => scenario(async f => {
  const s=await create(f); f.provider.outcome='decline'; const a=await f.api.bill(s.id); assert.equal(a.body.subscription.status,'past_due'); assert.equal(a.body.invoice.status,'failed'); f.provider.outcome='success'; const b=await f.api.bill(s.id); assert.equal(b.body.subscription.status,'active'); assert.equal(b.body.invoice.status,'paid'); assert.equal(f.provider.calls.length,2);
}));
test('active -> past_due -> canceled and no further billing', () => scenario(async f => {
  const s=await create(f); await f.api.bill(s.id); f.provider.outcome='decline'; assert.equal((await f.api.bill(s.id)).body.subscription.status,'past_due'); assert.equal((await f.api.retryExhausted(s.id)).body.status,'canceled'); assert.equal((await f.api.bill(s.id)).status,409); assert.equal(f.provider.calls.length,2);
}));
test('trialing and active cancellation; duplicate cancellation rejected', () => scenario(async f => {
  const a=await create(f); assert.equal((await f.api.cancel(a.id)).body.status,'canceled'); assert.equal((await f.api.cancel(a.id)).status,409); const b=await create(f); await f.api.bill(b.id); assert.equal((await f.api.cancel(b.id)).body.status,'canceled');
}));
test('webhook applies once, duplicate event recorded without invoice/provider duplication', () => scenario(async f => {
  const s=await create(f), id=pending(f,s.id), event=new WebhookBuilder(s.id,id).eventId('evt_replay').build(); assert.equal((await f.api.webhook(event)).body.disposition,'applied'); assert.equal((await f.api.webhook(event)).body.disposition,'duplicate'); assert.equal(f.db.webhookEvents.size,1); assert.equal(f.db.webhookDeliveries.length,2); assert.equal(f.db.invoices.size,1); assert.equal(f.provider.calls.length,0); assert.equal(f.db.audit.filter(x=>x.reason==='charge_success').length,1);
}));
test('failed webhook then success; stale failure cannot regress paid invoice', () => scenario(async f => {
  const s=await create(f), id=pending(f,s.id); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id).type('payment.failed').build())).body.disposition,'applied'); assert.equal(f.db.subscriptions.get(s.id)?.status,'past_due'); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id).build())).body.disposition,'applied'); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id).type('payment.failed').build())).body.disposition,'ignored'); assert.equal(f.db.subscriptions.get(s.id)?.status,'active'); assert.equal(f.db.invoices.get(id)?.status,'paid');
}));
test('canceled -> active webhook impossible', () => scenario(async f => {
  const s=await create(f),id=pending(f,s.id); await f.api.cancel(s.id); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id).build())).body.disposition,'ignored'); assert.equal(f.db.subscriptions.get(s.id)?.status,'canceled'); assert.equal(f.db.invoices.get(id)?.status,'pending');
}));
test('forged signature, malformed signed JSON/schema and mismatched amount rejected', () => scenario(async f => {
  const s=await create(f),id=pending(f,s.id); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id).build(),'0'.repeat(64))).status,401); const raw='{bad'; assert.equal((await f.api.request('POST','/webhooks/payment-provider',raw,{'x-provider-signature':sign(raw,f.secret)})).status,400); const malformed=JSON.stringify({event_id:'bad'}); assert.equal((await f.api.request('POST','/webhooks/payment-provider',malformed,{'x-provider-signature':sign(malformed,f.secret)})).status,400); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,id,1).build())).status,422); assert.equal(f.db.webhookEvents.size,0); assert.equal(f.db.invoices.get(id)?.status,'pending');
}));
test('provider timeout keeps pending/unknown; no false success', () => scenario(async f => {
  const s=await create(f); f.provider.outcome='timeout'; const r=await f.api.bill(s.id); assert.equal(r.body.outcome,'unknown'); assert.equal(r.body.invoice.status,'pending'); assert.equal(f.db.subscriptions.get(s.id)?.status,'trialing'); assert.equal(f.provider.calls.length,1);
}));
test('refund persists without inventing lifecycle transition', () => scenario(async f => {
  const s=await create(f),r=await f.api.bill(s.id); assert.equal((await f.api.webhook(new WebhookBuilder(s.id,r.body.invoice.id).type('payment.refunded').build())).body.disposition,'applied'); assert.equal(f.db.invoices.get(r.body.invoice.id)?.status,'refunded'); assert.equal(f.db.subscriptions.get(s.id)?.status,'active');
}));
test('explicit state machine disallows multiple illegal transitions', () => { const m=new SubscriptionStateMachine(); assert.equal(m.next('canceled','charge_success'),null); assert.equal(m.next('active','charge_success'),null); assert.equal(m.next('trialing','retry_exhausted'),null); assert.equal(m.next('past_due','cancel'),null); });
