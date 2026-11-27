import request from 'supertest';
import app from '../src/app';
import { createHmac } from 'crypto';

const webhookSecret = 'test_webhook_secret';

function createSignature(payload: object): string {
  return createHmac('sha256', webhookSecret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('Payment webhook', () => {
  let subscriptionId: string;

  beforeEach(async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'webhook_customer',
        plan: 'basic',
      });

    subscriptionId = response.body.id;
  });

  it('should activate subscription after payment success', async () => {
    const payload = {
      event_id: 'event_success_1',
      event_type: 'payment.succeeded',
      subscription_id: subscriptionId,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('active');
  });

  it('should mark subscription past_due after payment failure', async () => {
    const payload = {
      event_id: 'event_failure_1',
      event_type: 'payment.failed',
      subscription_id: subscriptionId,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('past_due');
  });

  it('should not process the same webhook event twice', async () => {
    const payload = {
      event_id: 'event_duplicate_1',
      event_type: 'payment.succeeded',
      subscription_id: subscriptionId,
    };

    await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(payload))
      .send(payload);

    const duplicateResponse = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(payload))
      .send(payload);

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.message).toBe('Webhook already processed');
  });

  it('should reject invalid webhook signature', async () => {
    const payload = {
      event_id: 'event_invalid_signature',
      event_type: 'payment.succeeded',
      subscription_id: subscriptionId,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', 'invalid_signature')
      .send(payload);

    expect(response.status).toBe(401);
  });

  it('should reject webhook without signature', async () => {
    const payload = {
      event_id: 'event_missing_signature',
      event_type: 'payment.succeeded',
      subscription_id: subscriptionId,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .send(payload);

    expect(response.status).toBe(401);
  });

  it('should not reactivate a canceled subscription', async () => {
    const cancelResponse = await request(app)
      .post(`/subscriptions/${subscriptionId}/cancel`);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.status).toBe('canceled');

    const payload = {
      event_id: 'event_canceled_success',
      event_type: 'payment.succeeded',
      subscription_id: subscriptionId,
    };

    const webhookResponse = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(payload))
      .send(payload);

    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body.status).toBe('canceled');
  });
});