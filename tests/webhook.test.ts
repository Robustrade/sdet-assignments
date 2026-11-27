import request from 'supertest';
import app from '../src/app';
import { createHmac } from 'crypto';

const webhookSecret = 'test_webhook_secret';

function createSignature(payload: object): string {
  return createHmac('sha256', webhookSecret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('POST /webhooks/payment-provider', () => {
  it('should activate subscription after successful payment', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_001',
        plan: 'basic',
      });

    const event = {
      event_id: 'event_test_001',
      event_type: 'payment.succeeded',
      subscription_id: created.body.id,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(event))
      .send(event);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('active');
  });

  it('should mark subscription as past_due after failed payment', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_002',
        plan: 'basic',
      });

    const event = {
      event_id: 'event_test_002',
      event_type: 'payment.failed',
      subscription_id: created.body.id,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', createSignature(event))
      .send(event);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('past_due');
  });

  it('should not process the same webhook event twice', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_003',
        plan: 'basic',
      });

    const event = {
      event_id: 'event_duplicate_001',
      event_type: 'payment.succeeded',
      subscription_id: created.body.id,
    };

    const signature = createSignature(event);

    const firstResponse = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', signature)
      .send(event);

    const secondResponse = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', signature)
      .send(event);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.message).toBe('Webhook already processed');
  });

  it('should reject an invalid webhook signature', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_004',
        plan: 'basic',
      });

    const event = {
      event_id: 'event_invalid_signature',
      event_type: 'payment.succeeded',
      subscription_id: created.body.id,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('x-webhook-signature', 'invalid_signature')
      .send(event);

    expect(response.status).toBe(401);
  });

  it('should reject a webhook without a signature', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_005',
        plan: 'basic',
      });

    const event = {
      event_id: 'event_missing_signature',
      event_type: 'payment.succeeded',
      subscription_id: created.body.id,
    };

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .send(event);

    expect(response.status).toBe(401);
  });
});