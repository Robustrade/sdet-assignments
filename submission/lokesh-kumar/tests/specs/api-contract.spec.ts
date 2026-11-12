import { beforeEach, describe, expect, it } from 'vitest';
import { aCreateSubscriptionRequest } from '../support/builders/SubscriptionRequestBuilder.js';
import { aWebhookEvent } from '../support/builders/WebhookEventBuilder.js';
import { TestEnvironment } from '../support/TestEnvironment.js';

describe('API contract: subscriptions', () => {
  let env: TestEnvironment;
  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it('POST /subscriptions creates a pro subscription with the documented payload shape', async () => {
    const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      customer_id: 'cust_001',
      plan: 'pro',
      status: 'trialing',
      price: 4900,
      currency: 'USD',
    });
    expect(res.body.id).toMatch(/^sub_/);
    expect(res.body.trial_ends_at).not.toBeNull();
    expect(Object.keys(res.body).sort()).toEqual(
      ['created_at', 'currency', 'customer_id', 'id', 'plan', 'price', 'status', 'trial_ends_at', 'updated_at'],
    );
  });

  it('GET /subscriptions/{id} returns exactly what creation returned', async () => {
    const created = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('pro').build());
    const fetched = await env.api.getSubscription(created.body.id);

    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  it('GET unknown subscription returns 404', async () => {
    const res = await env.api.getSubscription('sub_nope');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('subscription_not_found');
  });

  for (const field of ['customer_id', 'plan', 'payment_method_id'] as const) {
    it(`rejects a request without ${field} (400) and persists nothing`, async () => {
      const res = await env.api.createSubscription(aCreateSubscriptionRequest().without(field).build());

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_error');
      expect(env.subscriptions.count()).toBe(0);
      expect(env.invoices.count()).toBe(0);
      env.charges.expectNoCharges();
    });
  }

  it('rejects an unknown plan (400), persists nothing and never calls the provider', async () => {
    const res = await env.api.createSubscription(aCreateSubscriptionRequest().onPlan('platinum').build());

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('invalid_plan');
    expect(env.subscriptions.count()).toBe(0);
    env.charges.expectNoCharges();
  });

  it('rejects a malformed payment method (400)', async () => {
    const res = await env.api.createSubscription(aCreateSubscriptionRequest().withPaymentMethod('visa_4242').build());

    expect(res.status).toBe(400);
    expect(env.subscriptions.count()).toBe(0);
    env.charges.expectNoCharges();
  });

  it('rejects an unknown customer (404), persists nothing and never calls the provider', async () => {
    const res = await env.api.createSubscription(
      aCreateSubscriptionRequest().forCustomer('cust_ghost').onPlan('basic').build(),
    );

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('customer_not_found');
    expect(env.subscriptions.count()).toBe(0);
    expect(env.invoices.count()).toBe(0);
    env.charges.expectNoCharges();
  });

  it('rejects a body that is not valid JSON (400)', async () => {
    const res = await env.api.postRaw('/subscriptions', '{not json');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('invalid_json');
    expect(env.subscriptions.count()).toBe(0);
  });

  it('POST /subscriptions/{id}/cancel cancels a trialing subscription', async () => {
    const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
    const res = await env.api.cancelSubscription(sub.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
    expect(env.subscriptions.get(sub.id)?.status).toBe('canceled');
  });

  it('cancel of an unknown subscription returns 404', async () => {
    const res = await env.api.cancelSubscription('sub_nope');
    expect(res.status).toBe(404);
  });

  it('cancelling an already canceled subscription returns 409 and adds no audit entry', async () => {
    const sub = await env.aSubscription().onPlan('pro').inState('canceled').create();
    const auditBefore = env.audit.forSubscription(sub.id).length;

    const res = await env.api.cancelSubscription(sub.id);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('invalid_transition');
    expect(env.audit.forSubscription(sub.id)).toHaveLength(auditBefore);
    env.charges.expectNoCharges();
  });
});

describe('API contract: webhook endpoint request handling (separate from business logic)', () => {
  let env: TestEnvironment;
  let validEvent: Record<string, unknown>;

  beforeEach(async () => {
    env = TestEnvironment.create();
    const sub = await env.aSubscription().onPlan('pro').inState('trialing').create();
    const invoice = await env.leavePendingInvoice(sub.id);
    validEvent = aWebhookEvent().succeeded().forInvoice(invoice).build();
  });

  it('rejects a request with no signature (401) and persists nothing', async () => {
    const res = await env.webhooks.deliverUnsigned(validEvent);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('invalid_signature');
    expect(env.events.count()).toBe(0);
  });

  it('rejects a forged signature (401) and leaves the subscription untouched', async () => {
    const res = await env.webhooks.deliverForged(validEvent);
    expect(res.status).toBe(401);
    expect(env.events.count()).toBe(0);
    expect(env.subscriptions.get(validEvent.subscription_id as string)?.status).toBe('trialing');
  });

  it('rejects a body modified after signing (401)', async () => {
    const res = await env.webhooks.deliverTampered(validEvent, (raw) => raw.replace('4900', '1'));
    expect(res.status).toBe(401);
    expect(env.events.count()).toBe(0);
  });

  it('rejects a correctly signed body that is not JSON (400)', async () => {
    const res = await env.webhooks.deliverRaw('this is not json');
    expect(res.status).toBe(400);
    expect(env.events.count()).toBe(0);
  });

  const malformed: Array<[string, Record<string, unknown>]> = [
    ['missing event_id', aWebhookEvent().without('event_id').build()],
    ['unsupported type', aWebhookEvent().ofType('payment.exploded').build()],
    ['negative amount', aWebhookEvent().withAmount(-5).build()],
    ['non-integer amount', aWebhookEvent().withAmount('49.00').build()],
    ['missing invoice_id', aWebhookEvent().without('invoice_id').build()],
  ];
  for (const [label, payload] of malformed) {
    it(`rejects a signed but malformed payload: ${label} (400)`, async () => {
      const res = await env.webhooks.deliver(payload);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('malformed_payload');
      expect(env.events.count()).toBe(0);
    });
  }

  it('accepts a valid signed payload (200)', async () => {
    const res = await env.webhooks.deliver(validEvent);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
  });
});
