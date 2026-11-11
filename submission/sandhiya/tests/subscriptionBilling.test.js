import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BillingTestFixture, SubscriptionBuilder, WebhookBuilder } from '../src/testFixture.js';
import { SubscriptionStateMachine } from '../src/subscriptionStateMachine.js';

const secret = 'test-secret';
async function withFixture(options, run) {
  const fixture = new BillingTestFixture({ secret, ...options });
  await fixture.start();
  try { await run(fixture); } finally { await fixture.stop(); }
}

 test('creates trial subscription with plan price/trial and API/database agreement', async () => withFixture({}, async f => {
  const response = await f.createSubscription(new SubscriptionBuilder().build());
  assert.equal(response.status, 201);
  assert.equal(response.body.status, 'trialing');
  assert.equal(response.body.plan, 'pro');
  assert.equal(response.body.amount, 4900);
  assert.equal(response.body.trial_days, 14);
  assert.deepEqual(f.repository.getSubscription(response.body.id), response.body);
  assert.equal(f.repository.getAuditLog(response.body.id)[0].event, 'subscription_created');
  assert.equal(f.paymentProvider.calls.length, 0);
}));

test('basic plan applies its own price and trial length', async () => withFixture({}, async f => {
  const response = await f.createSubscription(new SubscriptionBuilder().withPlan('basic').build());
  assert.equal(response.body.amount, 2000);
  assert.equal(response.body.trial_days, 7);
}));

test('unknown plan and unknown customer are rejected without persistence/provider calls', async () => withFixture({}, async f => {
  const unknownPlan = await f.createSubscription({ customer_id: 'cust_001', plan: 'gold', payment_method_id: 'pm_1' });
  const unknownCustomer = await f.createSubscription({ customer_id: 'cust_missing', plan: 'pro', payment_method_id: 'pm_1' });
  assert.equal(unknownPlan.status, 400);
  assert.equal(unknownCustomer.status, 404);
  assert.equal(f.repository.subscriptions.size, 0);
  assert.equal(f.paymentProvider.calls.length, 0);
}));

test('missing customer/payment method/plan is rejected', async () => withFixture({}, async f => {
  for (const payload of [{ plan: 'pro', payment_method_id: 'pm_1' }, { customer_id: 'cust_001', plan: 'pro' }, { customer_id: 'cust_001', payment_method_id: 'pm_1' }]) {
    assert.equal((await f.createSubscription(payload)).status, 400);
  }
  assert.equal(f.repository.subscriptions.size, 0);
}));

test('retrieves and cancels a subscription; cancellation is terminal', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const id = created.body.id;
  assert.equal((await f.getSubscription(id)).status, 200);
  assert.equal((await f.cancelSubscription(id)).body.status, 'canceled');
  assert.equal((await f.cancelSubscription(id)).status, 400);
  const after = await f.postSignedWebhook(WebhookBuilder.success({ subscriptionId: id, eventId: 'evt_after_cancel', invoiceId: 'inv_after_cancel' }));
  assert.equal(after.body.ignored, true);
  assert.equal((await f.getSubscription(id)).body.status, 'canceled');
  assert.equal(f.repository.invoicesForSubscription(id).length, 0);
  assert.equal(f.repository.getEvent('evt_after_cancel').status, 'ignored');
}));

test('invalid and malformed webhook requests have no side effects', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const payload = WebhookBuilder.success({ subscriptionId: created.body.id, eventId: 'evt_invalid_sig', invoiceId: 'inv_sig' });
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal((await f.apiClient.postWebhook(payload, `${signature}bad`)).status, 401);
  assert.equal((await f.apiClient.postWebhook(payload, `${signature}x`)).status, 401);
  const malformedRaw = '{broken';
  const malformed = await f.apiClient.request('POST', '/webhooks/payment-provider', malformedRaw, { 'X-Provider-Signature': f.sign(malformedRaw) });
  assert.equal(malformed.status, 400);
  assert.equal(f.repository.webhookEvents.size, 0);
  assert.equal(f.repository.invoices.size, 0);
}));

test('signed webhook with incorrect amount is rejected without persistence', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const payload = WebhookBuilder.success({ subscriptionId: created.body.id, eventId: 'evt_wrong_amount', invoiceId: 'inv_wrong_amount', amount: 100 });
  const response = await f.postSignedWebhook(payload);
  assert.equal(response.status, 400);
  assert.equal(f.repository.invoices.size, 0);
  assert.equal(f.repository.webhookEvents.size, 0);
  assert.equal((await f.getSubscription(created.body.id)).body.status, 'trialing');
}));

test('successful provider charge validates complete request and persists paid invoice before active state', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const result = await f.completeTrial(created.body.id);
  assert.equal(f.paymentProvider.calls.length, 1);
  assert.deepEqual(f.paymentProvider.calls[0], {
    customerId: 'cust_001', amount: 4900, paymentMethodId: 'pm_test_visa_4242',
    subscriptionId: created.body.id, invoiceId: result.invoice.id, currency: 'USD',
    idempotencyKey: `charge:${result.invoice.id}`,
  });
  assert.equal(result.subscription.status, 'active');
  assert.equal(result.invoice.status, 'paid');
  assert.equal(f.repository.getInvoice(result.invoice.id).status, 'paid');
  assert.equal(f.repository.getEvent(`evt_${result.invoice.id}`).status, 'processed');
  assert.equal((await f.getSubscription(created.body.id)).body.status, 'active');
}));

test('declined provider charge moves trialing to past_due and records failed invoice', async () => withFixture({ providerOutcomes: ['decline'] }, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const result = await f.completeTrial(created.body.id);
  assert.equal(f.paymentProvider.calls.length, 1);
  assert.equal(result.subscription.status, 'past_due');
  assert.equal(result.invoice.status, 'failed');
  assert.equal(f.repository.invoicesForSubscription(created.body.id).length, 1);
  assert.equal(f.repository.invoicesForSubscription(created.body.id)[0].status, 'failed');
}));

test('provider timeout never activates subscription and records unknown attempt', async () => withFixture({ providerOutcomes: ['timeout'] }, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const result = await f.completeTrial(created.body.id);
  assert.equal(f.paymentProvider.calls.length, 1);
  assert.equal(result.subscription.status, 'past_due');
  assert.equal(result.invoice.status, 'unknown');
  assert.notEqual(result.subscription.status, 'active');
  assert.equal(f.repository.invoicesForSubscription(created.body.id).length, 1);
}));

test('duplicate webhook increments delivery audit but creates one invoice and no provider charge', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const event = WebhookBuilder.success({ subscriptionId: created.body.id, eventId: 'evt_dup', invoiceId: 'inv_dup' });
  const first = await f.postSignedWebhook(event);
  const second = await f.postSignedWebhook(event);
  assert.equal(first.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(f.repository.invoicesForSubscription(created.body.id).length, 1);
  assert.equal(f.repository.getEvent('evt_dup').delivery_count, 2);
  assert.equal(f.repository.getEvent('evt_dup').duplicate_count, 1);
  assert.equal(f.paymentProvider.calls.length, 0);
}));

test('late failure for an already-paid invoice is ignored and cannot regress active state', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  await f.postSignedWebhook(WebhookBuilder.success({ subscriptionId: created.body.id, eventId: 'evt_win', invoiceId: 'inv_order' }));
  const late = await f.postSignedWebhook(WebhookBuilder.failed({ subscriptionId: created.body.id, eventId: 'evt_late_fail', invoiceId: 'inv_order' }));
  assert.equal(late.body.ignored, true);
  assert.equal((await f.getSubscription(created.body.id)).body.status, 'active');
  assert.equal(f.repository.getInvoice('inv_order').status, 'paid');
  assert.equal(f.repository.getEvent('evt_late_fail').status, 'ignored');
}));

test('valid lifecycle: trialing -> past_due -> active -> past_due -> canceled', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const id = created.body.id;
  await f.postSignedWebhook(WebhookBuilder.failed({ subscriptionId: id, eventId: 'evt_f1', invoiceId: 'inv_f1' }));
  assert.equal((await f.getSubscription(id)).body.status, 'past_due');
  await f.postSignedWebhook(WebhookBuilder.success({ subscriptionId: id, eventId: 'evt_s1', invoiceId: 'inv_s1' }));
  assert.equal((await f.getSubscription(id)).body.status, 'active');
  await f.postSignedWebhook(WebhookBuilder.failed({ subscriptionId: id, eventId: 'evt_f2', invoiceId: 'inv_f2' }));
  assert.equal((await f.getSubscription(id)).body.status, 'past_due');
  const exhausted = await f.service.exhaustRetries(id);
  assert.equal(exhausted.status, 'canceled');
  assert.equal(f.stateMachine.canTransition('canceled', 'payment_succeeded'), false);
}));

test('refund marks a paid invoice refunded without inventing a subscription transition', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  await f.postSignedWebhook(WebhookBuilder.success({ subscriptionId: created.body.id, eventId: 'evt_pay', invoiceId: 'inv_refund' }));
  const refund = await f.postSignedWebhook(WebhookBuilder.refunded({ subscriptionId: created.body.id, eventId: 'evt_refund', invoiceId: 'inv_refund' }));
  assert.equal(refund.status, 200);
  assert.equal(f.repository.getInvoice('inv_refund').status, 'refunded');
  assert.equal((await f.getSubscription(created.body.id)).body.status, 'active');
  assert.equal(f.repository.getEvent('evt_refund').status, 'processed');
}));

test('refund without a paid invoice is safely ignored', async () => withFixture({}, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const response = await f.postSignedWebhook(WebhookBuilder.refunded({ subscriptionId: created.body.id, eventId: 'evt_ref_no_pay', invoiceId: 'inv_missing' }));
  assert.equal(response.body.ignored, true);
  assert.equal(f.repository.invoices.size, 0);
  assert.equal((await f.getSubscription(created.body.id)).body.status, 'trialing');
}));

test('state machine explicitly allows every lifecycle transition in the assignment', () => {
  const machine = new SubscriptionStateMachine();
  const allowed = [
    ['trialing', 'api_cancel', 'canceled'],
    ['trialing', 'payment_succeeded', 'active'],
    ['trialing', 'payment_failed', 'past_due'],
    ['active', 'api_cancel', 'canceled'],
    ['active', 'payment_failed', 'past_due'],
    ['past_due', 'payment_succeeded', 'active'],
    ['past_due', 'retries_exhausted', 'canceled'],
  ];
  for (const [from, trigger, to] of allowed) assert.equal(machine.transition(from, trigger), to);
});

test('state machine rejects at least two invalid transitions', () => {
  const machine = new SubscriptionStateMachine();
  assert.throws(() => machine.transition('canceled', 'payment_succeeded'), /Invalid transition/);
  assert.throws(() => machine.transition('active', 'payment_succeeded'), /Invalid transition/);
  assert.throws(() => machine.transition('trialing', 'retries_exhausted'), /Invalid transition/);
});

test('event and persistence invariants remain coherent after provider decline', async () => withFixture({ providerOutcomes: ['decline'] }, async f => {
  const created = await f.createSubscription(new SubscriptionBuilder().build());
  const result = await f.completeTrial(created.body.id);
  const stored = f.repository.getSubscription(created.body.id);
  const invoices = f.repository.invoicesForSubscription(created.body.id);
  assert.equal(stored.status, result.subscription.status);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].status, 'failed');
  assert.equal(invoices.some(invoice => invoice.status === 'paid'), false);
  assert.equal(f.repository.getAuditLog(created.body.id).length >= 2, true);
}));
