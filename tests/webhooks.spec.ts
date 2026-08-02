import { test, expect } from './support/fixtures';
import { SubscriptionPayloadBuilder, WebhookBuilder } from './support/builders/PayloadBuilder';
import { createWebhookSignature } from '../src/api/signature';

test.describe('External Integration & Webhooks', () => {
  const sign = (payload: any) => createWebhookSignature(JSON.stringify(payload));

  test('should reject missing signature', async ({ request, serverUrl }) => {
    const webhook = new WebhookBuilder().build();
    const response = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      data: webhook
    });
    expect(response.status()).toBe(401);
  });

  test('should reject invalid signature', async ({ request, serverUrl }) => {
    const webhook = new WebhookBuilder().build();
    const response = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: { 'x-provider-signature': 'invalid-signature' },
      data: webhook
    });
    expect(response.status()).toBe(401);
  });

  test('should handle duplicate webhooks idempotently', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    const signature = sign(webhook);

    const body = JSON.stringify(webhook);
    const res1 = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': signature
      },
      data: body
    });
    expect(res1.status()).toBe(200);

    const res2 = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': signature
      },
      data: body
    });
    expect(res2.status()).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe('ignored_duplicate');

    const invoices = db.getInvoices(id);
    expect(invoices.length).toBe(1);
  });

  test('should process payment.refunded without changing subscription state', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.refunded').build();
    const signature = sign(webhook);

    const response = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': signature
      },
      data: JSON.stringify(webhook)
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('processed');

    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('trialing');
    const invoices = db.getInvoices(id);
    expect(invoices[0].status).toBe('refunded');
  });

  test('mock provider is called exactly once for no-trial plan creation', async ({ request, serverUrl, paymentProvider }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('no_trial').build();
    
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(201);
    const body = await response.json();
    
    expect(body.state).toBe('active');
    expect(paymentProvider.calls.length).toBe(1);
    expect(paymentProvider.calls[0].amount).toBe(5000);
    expect(paymentProvider.calls[0].customerId).toBe(payload.customer_id);
  });

  test('mock provider decline handles gracefully', async ({ request, serverUrl, paymentProvider }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('no_trial').build();
    paymentProvider.nextOutcome = 'decline';

    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(402);
    const body = await response.json();
    expect(body.error).toBe('Payment failed');
    expect(body.subscription.state).toBe('past_due');
    expect(paymentProvider.calls.length).toBe(1);
  });

  test('mock provider timeout returns 502 and stores a failed invoice', async ({ request, serverUrl, paymentProvider, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('no_trial').build();
    paymentProvider.nextOutcome = 'timeout';

    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Payment provider timeout');
    expect(paymentProvider.calls.length).toBe(1);

    const invoices = db.getInvoices(body.subscription.id);
    expect(invoices[0]?.status).toBe('failed');
  });
});
