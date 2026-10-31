
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { InMemoryRepository } from '../src/repository.js';
import { MockPaymentProvider } from '../src/payment-provider.js';

const WEBHOOK_SECRET = 'test_webhook_secret';

function signPayload(payload: object): string {
  return createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

const repository = new InMemoryRepository();
const paymentProvider = new MockPaymentProvider();
const app = createApp(repository, paymentProvider);

beforeEach(() => {
  repository.clear();
  paymentProvider.reset();

  repository.addCustomer({
    id: 'customer_1',
    email: 'naga@example.com',
  });

  repository.addPlan({
    name: 'basic',
    price: 10,
    currency: 'USD',
    trialDays: 7,
    chargeImmediately: false,
  });

  repository.saveSubscription({
    id: 'sub_1',
    customerId: 'customer_1',
    plan: 'basic',
    paymentMethodId: 'pm_test_123',
    status: 'trialing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trialEndsAt: null,
  });

  repository.saveInvoice({
    id: 'inv_1',
    subscriptionId: 'sub_1',
    amount: 10,
    currency: 'USD',
    status: 'pending',
    providerReference: null,
    createdAt: new Date().toISOString(),
  });
});

describe('Payment webhook signature validation and processing', () => {
  it('rejects a request with an invalid signature', async () => {
    const payload = {
      eventId: 'evt_invalid',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      type: 'payment.succeeded',
    };

    const response = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', 'invalidsignature')
      .send(payload);

    expect(response.status).toBe(401);
  });

  it('processes a valid payment success event', async () => {
    const payload = {
      eventId: 'evt_success',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      type: 'payment.succeeded',
    };

    const response = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', signPayload(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(false);
    expect(repository.getInvoice('inv_1')?.status).toBe('paid');
    expect(repository.getSubscription('sub_1')?.status).toBe('active');
    expect(repository.getPaymentEvent('evt_success')?.processed).toBe(true);
  });

  it('does not process the same event twice', async () => {
    const payload = {
      eventId: 'evt_duplicate',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      type: 'payment.succeeded',
    };

    const firstResponse = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', signPayload(payload))
      .send(payload);

    const secondResponse = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', signPayload(payload))
      .send(payload);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(true);
    expect(repository.getPaymentEventsForSubscription('sub_1')).toHaveLength(1);
  });

  
  it('marks the invoice failed when payment fails', async () => {
    const payload = {
      eventId: 'evt_failure',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      type: 'payment.failed',
    };

    const response = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', signPayload(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(repository.getInvoice('inv_1')?.status).toBe('failed');
    expect(repository.getSubscription('sub_1')?.status).toBe('past_due');
  });

  it('marks the invoice refunded when a refund event arrives', async () => {
    const payload = {
      eventId: 'evt_refund',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      type: 'payment.refunded',
    };

    const response = await request(app)
      .post('/webhooks/payment')
      .set('x-webhook-signature', signPayload(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(repository.getInvoice('inv_1')?.status).toBe('refunded');
    expect(repository.getPaymentEvent('evt_refund')?.processed).toBe(true);
  });

  it('rejects a request without a signature', async () => {
    const response = await request(app)
      .post('/webhooks/payment')
      .send({ eventId: 'evt_missing' });

    expect(response.status).toBe(401);
  });
});
