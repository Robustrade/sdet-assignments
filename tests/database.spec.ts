import { test, expect } from './support/fixtures';
import { SubscriptionPayloadBuilder, WebhookBuilder } from './support/builders/PayloadBuilder';
import { createWebhookSignature } from '../src/api/signature';

test.describe('Database Validation', () => {
  test('should persist invoice on successful webhook', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    const body = JSON.stringify(webhook);
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(body)
      },
      data: body
    });

    const invoices = db.getInvoices(id);
    expect(invoices.length).toBe(1);
    expect(invoices[0].status).toBe('paid');
    expect(invoices[0].id).toBe(webhook.invoice_id);
    expect(invoices[0].amount).toBe(webhook.amount);
  });

  test('should persist failed invoice on payment.failed webhook', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.failed').build();
    const body = JSON.stringify(webhook);
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(body)
      },
      data: body
    });

    const invoices = db.getInvoices(id);
    expect(invoices.length).toBe(1);
    expect(invoices[0].status).toBe('failed');
  });

  test('should store subscription in database correctly upon creation', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const saved = db.getSubscription(id);
    expect(saved).not.toBeNull();
    expect(saved?.customerId).toBe(payload.customer_id);
    expect(saved?.plan).toBe(payload.plan);
    expect(saved?.state).toBe('trialing');
  });
});
