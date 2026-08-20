import request from 'supertest';
import { Express } from 'express';
import { buildApp, Repos } from '../src/api/app';
import { MockPaymentProvider } from '../src/infra/MockPaymentProvider';
import { SubscriptionBuilder } from '../src/testing/builders/SubscriptionBuilder';
import { WebhookPayloadBuilder } from '../src/testing/builders/WebhookPayloadBuilder';
import { signPayload } from '../src/api/webhookSignature';

async function postWebhook(app: Express, payload: object, { signed = true }: { signed?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const req = request(app).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
  if (signed) req.set('X-Provider-Signature', signPayload(raw));
  return req.send(raw);
}

describe('Webhook signature validation', () => {
  let provider: MockPaymentProvider;
  let app: Express;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    ({ app } = buildApp(provider));
  });

  test('rejects an unsigned webhook', async () => {
    const payload = new WebhookPayloadBuilder().build();
    const res = await postWebhook(app, payload, { signed: false });
    expect(res.status).toBe(400);
  });

  test('rejects a webhook with an invalid signature', async () => {
    const raw = JSON.stringify(new WebhookPayloadBuilder().build());
    const res = await request(app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('X-Provider-Signature', 'not-a-real-signature')
      .send(raw);
    expect(res.status).toBe(400);
  });

  test('rejects a malformed payload even under a valid signature over those exact bytes', async () => {
    const raw = '{not valid json';
    const res = await request(app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('X-Provider-Signature', signPayload(raw))
      .send(raw);
    expect(res.status).toBe(400);
  });
});

describe('Webhook idempotency & duplicate delivery', () => {
  let provider: MockPaymentProvider;
  let app: Express;
  let repos: Repos;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    ({ app, repos } = buildApp(provider));
  });

  test('the same event_id delivered twice results in the transition happening exactly once', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    const payload = new WebhookPayloadBuilder()
      .forSubscription(created.body.id)
      .withType('payment.succeeded')
      .build();

    const first = await postWebhook(app, payload);
    const second = await postWebhook(app, payload); // exact same event_id

    expect(first.body.applied).toBe(true);
    expect(second.body.applied).toBe(false);
    expect(second.body.reason).toBe('duplicate_event');

    const sub = await request(app).get(`/subscriptions/${created.body.id}`);
    expect(sub.body.status).toBe('active');
  });

  test('a duplicate webhook does not create a duplicate invoice row', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    const payload = new WebhookPayloadBuilder()
      .forSubscription(created.body.id)
      .withType('payment.succeeded')
      .build();

    await postWebhook(app, payload);
    await postWebhook(app, payload);

    expect(repos.invoices.findBySubscription(created.body.id)).toHaveLength(1);
  });

  test('a payment.succeeded webhook cannot reactivate an already-canceled subscription', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    await request(app).post(`/subscriptions/${created.body.id}/cancel`);

    const payload = new WebhookPayloadBuilder()
      .forSubscription(created.body.id)
      .withType('payment.succeeded')
      .build();
    const res = await postWebhook(app, payload);

    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toBe('invalid_transition');

    const sub = await request(app).get(`/subscriptions/${created.body.id}`);
    expect(sub.body.status).toBe('canceled');
  });

  test('a late payment.failed for an already-succeeded invoice does not regress an active subscription', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    const subId = created.body.id;
    const sharedInvoiceId = 'inv_shared_001';

    const succeeded = new WebhookPayloadBuilder()
      .forSubscription(subId)
      .withType('payment.succeeded')
      .withInvoiceId(sharedInvoiceId)
      .build();
    await postWebhook(app, succeeded);

    const lateFailed = new WebhookPayloadBuilder()
      .forSubscription(subId)
      .withType('payment.failed')
      .withInvoiceId(sharedInvoiceId)
      .withEventId('evt_late_out_of_order')
      .build();
    const res = await postWebhook(app, lateFailed);

    expect(res.body.applied).toBe(false);
    expect(res.body.reason).toBe('stale_out_of_order_event');

    const sub = await request(app).get(`/subscriptions/${subId}`);
    expect(sub.body.status).toBe('active'); // did NOT regress to past_due
  });
});
