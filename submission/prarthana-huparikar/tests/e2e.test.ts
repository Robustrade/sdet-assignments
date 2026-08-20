import request from 'supertest';
import { buildApp } from '../src/api/app';
import { MockPaymentProvider } from '../src/infra/MockPaymentProvider';
import { SubscriptionBuilder } from '../src/testing/builders/SubscriptionBuilder';
import { WebhookPayloadBuilder } from '../src/testing/builders/WebhookPayloadBuilder';
import { signPayload } from '../src/api/webhookSignature';

describe('End-to-end lifecycle flow', () => {
  test('trialing -> active via webhook, and persisted state matches API-visible state', async () => {
    const provider = new MockPaymentProvider();
    const { app, repos } = buildApp(provider);

    const createRes = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    expect(createRes.body.status).toBe('trialing');

    const payload = new WebhookPayloadBuilder()
      .forSubscription(createRes.body.id)
      .withType('payment.succeeded')
      .build();
    const raw = JSON.stringify(payload);

    const webhookRes = await request(app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('X-Provider-Signature', signPayload(raw))
      .send(raw);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.applied).toBe(true);

    const getRes = await request(app).get(`/subscriptions/${createRes.body.id}`);
    expect(getRes.body.status).toBe('active');

    const persisted = repos.subs.findById(createRes.body.id);
    expect(persisted?.status).toBe('active');
    expect(repos.invoices.findBySubscription(createRes.body.id)).toHaveLength(1);
    expect(repos.webhookEvents.hasProcessed(payload.event_id)).toBe(true);
  });

  test('full failure-then-recovery path: trial fails, subscription past_due, retry succeeds, becomes active', async () => {
    const provider = new MockPaymentProvider();
    const { app } = buildApp(provider);

    const createRes = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());

    provider.setOutcome('decline');
    const trialEndRes = await request(app).post(`/subscriptions/${createRes.body.id}/simulate-trial-end`);
    expect(trialEndRes.body.status).toBe('past_due');

    const retryPayload = new WebhookPayloadBuilder()
      .forSubscription(createRes.body.id)
      .withType('payment.succeeded')
      .build();
    const raw = JSON.stringify(retryPayload);
    await request(app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json')
      .set('X-Provider-Signature', signPayload(raw))
      .send(raw);

    const finalRes = await request(app).get(`/subscriptions/${createRes.body.id}`);
    expect(finalRes.body.status).toBe('active');
  });
});
