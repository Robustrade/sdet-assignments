import { test, expect } from './support/fixtures';
import { SubscriptionPayloadBuilder, WebhookBuilder } from './support/builders/PayloadBuilder';
import { createWebhookSignature } from '../src/api/signature';

test.describe('State-Machine / Workflow Validation', () => {
  test('trialing -> active on payment success', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    const body = JSON.stringify(webhook);
    const webhookRes = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(body)
      },
      data: body
    });

    expect(webhookRes.status()).toBe(200);
    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('active');
  });

  test('trialing -> past_due on payment failure', async ({ request, serverUrl, db }) => {
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

    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('past_due');
  });

  test('active -> past_due on recurring payment failure', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    // Make it active
    const webhookSuccess = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    const successBody = JSON.stringify(webhookSuccess);
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(successBody)
      },
      data: successBody
    });

    // Make it past_due
    const webhookFail = new WebhookBuilder().withEventId(`evt_${Date.now()}_1`).withSubscription(id).withType('payment.failed').build();
    const failBody = JSON.stringify(webhookFail);
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(failBody)
      },
      data: failBody
    });

    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('past_due');
  });

  test('invalid transition from canceled to active should be ignored', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    await request.post(`${serverUrl}/subscriptions/${id}/cancel`);

    const webhook = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    const signature = createWebhookSignature(JSON.stringify(webhook));
    const webhookRes = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: { 'x-provider-signature': signature },
      data: webhook
    });

    expect(webhookRes.status()).toBe(200); 
    const body = await webhookRes.json();
    expect(body.status).toBe('ignored_invalid_transition');
    
    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('canceled');
  });

  test('payment.failed after payment.succeeded is ignored and leaves active state', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const successWebhook = new WebhookBuilder().withSubscription(id).withType('payment.succeeded').build();
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: { 'x-provider-signature': createWebhookSignature(JSON.stringify(successWebhook)) },
      data: successWebhook
    });

    const webhookId = `evt_${Date.now()}_fail`;
    const failWebhook = new WebhookBuilder().withSubscription(id).withEventId(webhookId).withType('payment.failed').withInvoiceId(successWebhook.invoice_id).build();
    const failBody = JSON.stringify(failWebhook);
    const failRes = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(failBody)
      },
      data: failBody
    });

    expect(failRes.status()).toBe(200);
    const body = await failRes.json();
    expect(body.status).toBe('ignored_invalid_transition');

    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('active');
  });

  test('past_due retries exhausted transitions to canceled', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const failWebhook = new WebhookBuilder().withSubscription(id).withType('payment.failed').build();
    const failBody = JSON.stringify(failWebhook);
    await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(failBody)
      },
      data: failBody
    });

    const exhaustedWebhook = new WebhookBuilder().withSubscription(id).withEventId(`evt_${Date.now()}_exhausted`).withType('payment.retry_exhausted').build();
    const exhaustedBody = JSON.stringify(exhaustedWebhook);
    const exhaustedRes = await request.post(`${serverUrl}/webhooks/payment-provider`, {
      headers: {
        'content-type': 'application/json',
        'x-provider-signature': createWebhookSignature(exhaustedBody)
      },
      data: exhaustedBody
    });

    expect(exhaustedRes.status()).toBe(200);
    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('canceled');
  });
});
