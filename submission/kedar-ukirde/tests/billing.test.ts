import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { PLANS, SubscriptionLifecycle } from '../src/domain.js';
import { SubscriptionRequestBuilder, WebhookBuilder } from '../src/builders.js';
import { sign } from '../src/service.js';
import { BillingFixture } from './fixture.js';

describe('subscription API and provider seam', () => {
  it('creates a plan-configured trial and exposes the same persisted state', async () => {
    const f = new BillingFixture();
    const response = await f.subscription();
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('trialing');
    expect(f.repository.getSubscription(response.body.id)).toMatchObject({ plan: 'pro', status: 'trialing' });
    expect(f.repository.eventsFor(response.body.id)[0].reason).toContain(`trial_days=${PLANS.pro.trialDays}`);
    expect(f.provider.calls).toHaveLength(0);
    expect((await f.api.get(response.body.id)).body).toEqual(response.body);
  });

  it('rejects invalid creation without persistence or charge calls', async () => {
    const f = new BillingFixture();
    expect((await f.api.create(new SubscriptionRequestBuilder().plan('gold').build())).status).toBe(400);
    expect((await f.api.create(new SubscriptionRequestBuilder().customer('missing').build())).status).toBe(404);
    expect((await f.api.create(new SubscriptionRequestBuilder().omit('payment_method_id').build())).status).toBe(400);
    expect(f.repository.subscriptions.size).toBe(0);
    expect(f.provider.calls).toHaveLength(0);
  });

  it('records exact provider arguments and successful charge evidence before becoming active', async () => {
    const f = new BillingFixture();
    const created = await f.subscription();
    const response = await f.api.charge(created.body.id);
    expect(response.status).toBe(201);
    expect(response.body.subscription.status).toBe('active');
    expect(f.provider.calls).toEqual([{ customerId: 'cust_001', paymentMethodId: 'pm_test_visa_4242', amount: 4900, currency: 'USD', idempotencyKey: response.body.invoice.id }]);
    expect(f.repository.invoicesFor(created.body.id)).toMatchObject([{ status: 'succeeded', amount: 4900 }]);
    expect((await f.api.get(created.body.id)).body.status).toBe('active');
  });

  it.each([{ outcome: 'decline' as const, expected: 'past_due', invoice: 'failed' }, { outcome: 'timeout' as const, expected: 'past_due', invoice: 'unknown' }])('persists $outcome outcome without claiming success', async ({ outcome, expected, invoice }) => {
    const f = new BillingFixture(); f.provider.next = { outcome, reference: `ref_${outcome}` };
    const created = await f.subscription(); const response = await f.api.charge(created.body.id);
    expect(response.body.subscription.status).toBe(expected);
    expect(response.body.invoice.status).toBe(invoice);
    expect(f.provider.calls).toHaveLength(1);
    expect(f.repository.getSubscription(created.body.id)?.status).toBe(expected);
  });

  it('cancels trialing subscriptions and rejects a second cancellation', async () => {
    const f = new BillingFixture();
    const created = await f.subscription();
    expect((await f.api.cancel(created.body.id)).body.status).toBe('canceled');
    expect((await f.api.cancel(created.body.id)).status).toBe(409);
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('canceled');
  });

  it('cancels an active subscription and persists the terminal state', async () => {
    const f = new BillingFixture();
    const created = await f.subscription();
    const charge = await f.api.charge(created.body.id);
    expect(charge.body.subscription.status).toBe('active');
    const canceled = await f.api.cancel(created.body.id);
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('canceled');
    expect(f.provider.calls).toHaveLength(1);
  });
});

describe('signed webhook handling and idempotency', () => {
  it('processes a signed success once and records duplicate delivery without duplicate invoice or audit effects', async () => {
    const f = new BillingFixture(); const created = await f.subscription();
    const payload = new WebhookBuilder().subscription(created.body.id).eventId('evt_same').invoice('inv_same').build();
    expect((await f.api.webhook(payload)).body.subscription.status).toBe('active');
    const auditCount = f.repository.eventsFor(created.body.id).length;
    expect((await f.api.webhook(payload)).body.duplicate).toBe(true);
    expect(f.repository.invoicesFor(created.body.id)).toHaveLength(1);
    expect(f.repository.eventsFor(created.body.id)).toHaveLength(auditCount);
    expect([...f.repository.webhookEvents.values()].filter(x => x.event_id === 'evt_same')).toHaveLength(2);
    expect(f.provider.calls).toHaveLength(0);
  });

  it('rejects forged signatures, malformed signed JSON, and invalid payloads before processing', async () => {
    const f = new BillingFixture(); const created = await f.subscription();
    const body = JSON.stringify({ event_id: 'evt_bad', type: 'payment.succeeded', subscription_id: created.body.id, invoice_id: 'inv', amount: 1, currency: 'USD' });
    const forged = await request(f.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json').set('X-Provider-Signature', 'forged').send(body);
    expect(forged.status).toBe(401);
    const malformed = '{';
    const malformedResponse = await request(f.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json').set('X-Provider-Signature', sign(malformed)).send(malformed);
    expect(malformedResponse.status).toBe(400);
    const invalidPayload = JSON.stringify({
      event_id: 'evt_invalid',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_invalid',
    });
    const invalidResponse = await request(f.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('X-Provider-Signature', sign(invalidPayload))
      .send(invalidPayload);
    expect(invalidResponse.status).toBe(400);
    expect(f.repository.invoices.size).toBe(0);
  });

  it('does not reactivate canceled subscriptions or regress success on a stale failure', async () => {
    const f = new BillingFixture(); const created = await f.subscription();
    await f.api.cancel(created.body.id);
    await f.webhook(created.body.id, 'payment.succeeded', 'inv_late', 'evt_late');
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('canceled');
    expect(f.repository.invoices.has('inv_late')).toBe(false);
    const g = new BillingFixture(); const active = await g.subscription();
    await g.webhook(active.body.id, 'payment.succeeded', 'inv_order', 'evt_ok');
    await g.webhook(active.body.id, 'payment.failed', 'inv_order', 'evt_old');
    expect(g.repository.getSubscription(active.body.id)?.status).toBe('active');
    expect(g.repository.invoices.get('inv_order')?.status).toBe('succeeded');
  });

  it('records a refund notification without changing the active state or original payment evidence', async () => {
    const f = new BillingFixture();
    const created = await f.subscription();
    await f.webhook(created.body.id, 'payment.succeeded', 'inv_paid', 'evt_paid');

    const refund = await f.webhook(created.body.id, 'payment.refunded', 'inv_paid', 'evt_refund');

    expect(refund.status).toBe(200);
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('active');
    expect(f.repository.invoices.get('inv_paid')?.status).toBe('succeeded');
    expect(f.repository.webhookEvents.get('evt_refund')?.disposition).toBe('processed');
    expect(f.repository.eventsFor(created.body.id).at(-1)?.reason).toBe('payment.refunded');
  });

  it('drives active to past_due, past_due back to active, and past_due to canceled', async () => {
    const f = new BillingFixture(); const created = await f.subscription();
    await f.webhook(created.body.id, 'payment.succeeded', 'inv_1', 'evt_1');
    await f.webhook(created.body.id, 'payment.failed', 'inv_2', 'evt_2');
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('past_due');
    await f.webhook(created.body.id, 'payment.succeeded', 'inv_3', 'evt_3');
    expect(f.repository.getSubscription(created.body.id)?.status).toBe('active');
    expect(SubscriptionLifecycle.transition('past_due', 'exhausted')).toBe('canceled');
    expect(() => SubscriptionLifecycle.transition('canceled', 'success')).toThrow();
    expect(() => SubscriptionLifecycle.transition('trialing', 'exhausted')).toThrow();
  });
});
