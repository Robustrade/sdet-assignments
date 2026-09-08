import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestContext } from '../../src/application/testContext';
import { TestHttpServer } from '../../src/api/httpServer';
import { SubscriptionRequestBuilder } from '../../src/builders/testDataBuilders';

const ctx = new TestContext(); const http = new TestHttpServer(ctx.service); let base = '';
before(async()=>{ctx.reset(); base=`http://127.0.0.1:${(await http.listen()).port}`;});
after(async()=>{await http.close();});

async function request(method: string, path: string, body?: any, headers: Record<string,string> = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type':'application/json', connection:'close', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

before(()=>ctx.reset());
test('creates pro subscription in trialing and retrieves it', async () => {
  ctx.reset(); const payload = new SubscriptionRequestBuilder().build(); const created = await request('POST', '/subscriptions', payload);
  assert.equal(created.status, 201); assert.equal(created.body.status, 'trialing'); assert.equal(created.body.plan, 'pro'); assert.equal(ctx.provider.calls.length, 0);
  const got = await request('GET', `/subscriptions/${created.body.id}`); assert.deepEqual(got.body, created.body);
});

test('immediate basic plan charges provider exactly once with correct arguments', async () => {
  ctx.reset(); const payload = new SubscriptionRequestBuilder().withPlan('basic').build(); const created = await request('POST', '/subscriptions', payload);
  assert.equal(created.status, 201); assert.equal(created.body.status, 'active'); assert.equal(ctx.provider.calls.length, 1); assert.deepEqual(ctx.provider.calls[0], { customerId:'cust_001', paymentMethodId:'pm_test_visa_4242', amountCents:1000, currency:'USD', reference:'inv_1' }); assert.equal(ctx.repo.countInvoices(created.body.id), 1);
});

test('rejects unknown plan, unknown customer, and missing payment method without provider calls', async () => {
  ctx.reset(); assert.equal((await request('POST','/subscriptions',{customerId:'cust_001',plan:'gold',paymentMethodId:'pm'})).status,400); assert.equal((await request('POST','/subscriptions',{customerId:'cust_999',plan:'pro',paymentMethodId:'pm'})).status,404); assert.equal((await request('POST','/subscriptions',{customerId:'cust_001',plan:'pro'})).status,400); assert.equal(ctx.provider.calls.length,0);
});

test('changes plan, then cancels active subscription and rejects second cancellation', async () => {
  ctx.reset(); const created = await request('POST','/subscriptions',{customerId:'cust_001',plan:'basic',paymentMethodId:'pm_test'}); const changed = await request('POST',`/subscriptions/${created.body.id}/plan`,{plan:'pro'}); assert.equal(changed.status,200); assert.equal(changed.body.plan,'pro'); assert.equal(ctx.provider.calls.length,1); const canceled = await request('POST',`/subscriptions/${created.body.id}/cancel`,{}); assert.equal(canceled.status,200); assert.equal(canceled.body.status,'canceled'); assert.equal((await request('POST',`/subscriptions/${created.body.id}/cancel`,{})).status,409);
});
