import request from 'supertest';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { createServer } from '../src/service/server';
import { InMemoryRepository } from '../src/persistence/repository';
import { MockPaymentProvider } from '../src/payment/mock-payment-provider';

describe('Subscription & Billing End-to-End Workflow', () => {
  let app: any;
  let repository: InMemoryRepository;
  let paymentProvider: MockPaymentProvider;

  beforeEach(() => {
    repository = new InMemoryRepository();
    paymentProvider = new MockPaymentProvider();
    app = createServer(repository, paymentProvider);
  });

  it('creates subscription in trialing state for pro plan with trial days', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_001',
        plan: 'pro',
        payment_method_id: 'pm_visa',
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('trialing');
    expect(response.body.plan).toBe('pro');

    const persisted = repository.getSubscription(response.body.id);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe('trialing');
  });

  it('rejects webhooks with invalid or missing HMAC signatures', async () => {
    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'invalid_signature')
      .send({ event_id: 'evt_1', type: 'payment.succeeded', subscription_id: 'sub_1' });

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('signature');
  });

  it('prevents reactivation of canceled subscriptions via incoming webhooks', async () => {
    // Seed canceled subscription
    const subId = 'sub_canceled_123';
    repository.saveSubscription({
      id: subId,
      customerId: 'cust_001',
      plan: 'pro',
      status: 'canceled',
      paymentMethodId: 'pm_visa',
      createdAt: new Date(),
    });

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'valid_hmac_signature')
      .send({
        event_id: 'evt_stray_charge',
        type: 'payment.succeeded',
        subscription_id: subId,
        amount: 4900,
      });

    // Should reject transition attempt from terminal state
    expect(response.status).toBe(400);

    const persisted = repository.getSubscription(subId);
    expect(persisted?.status).toBe('canceled');
  });
});