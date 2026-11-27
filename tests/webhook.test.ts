import request from 'supertest';
import app from '../src/app';

describe('POST /webhooks/payment-provider', () => {
  it('should activate subscription after successful payment', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_webhook_001',
        plan: 'basic',
      });

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .send({
        event_id: 'event_test_001',
        event_type: 'payment.succeeded',
        subscription_id: created.body.id,
      });

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

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .send({
        event_id: 'event_test_002',
        event_type: 'payment.failed',
        subscription_id: created.body.id,
      });

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

    const firstResponse = await request(app)
      .post('/webhooks/payment-provider')
      .send(event);

    const secondResponse = await request(app)
      .post('/webhooks/payment-provider')
      .send(event);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.message).toBe('Webhook already processed');
  });
});