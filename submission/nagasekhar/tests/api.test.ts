import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { InMemoryRepository } from '../src/repository.js';
import { MockPaymentProvider } from '../src/payment-provider.js';

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

  repository.addPlan({
    name: 'pro',
    price: 30,
    currency: 'USD',
    trialDays: 0,
    chargeImmediately: true,
  });
});

describe('Subscription API', () => {
  it('creates a subscription and returns 201', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    expect(response.status).toBe(201);
    expect(response.body.customerId).toBe('customer_1');
    expect(response.body.plan).toBe('basic');
    expect(response.body.status).toBe('trialing');
    expect(response.body.id).toBeDefined();
  });

  it('returns 400 when the customer does not exist', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'unknown_customer',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Unknown customer');
  });

  it('retrieves an existing subscription', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    const response = await request(app).get(
      `/subscriptions/${created.body.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
  });

  it('returns 404 when the subscription does not exist', async () => {
    const response = await request(app).get('/subscriptions/unknown_id');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found');
  });

  it('cancels an existing subscription', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    const response = await request(app).post(
      `/subscriptions/${created.body.id}/cancel`,
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
  });

  it('returns 404 when cancelling an unknown subscription', async () => {
    const response = await request(app).post(
      '/subscriptions/unknown_id/cancel',
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Unknown subscription');
  });

  it('changes an existing subscription plan', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    const response = await request(app)
      .patch(`/subscriptions/${created.body.id}/plan`)
      .send({ plan: 'pro' });

    expect(response.status).toBe(200);
    expect(response.body.plan).toBe('pro');
    expect(response.body.status).toBe('trialing');
  });

  it('returns 404 when changing plan for an unknown subscription', async () => {
    const response = await request(app)
      .patch('/subscriptions/unknown_id/plan')
      .send({ plan: 'pro' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Unknown subscription');
  });

  it('returns 400 when changing to an unknown plan', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    const response = await request(app)
      .patch(`/subscriptions/${created.body.id}/plan`)
      .send({ plan: 'unknown' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Unknown plan');
  });

  it('returns 409 when changing plan for a canceled subscription', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_1',
        plan: 'basic',
        paymentMethodId: 'pm_test_123',
      });

    await request(app).post(
      `/subscriptions/${created.body.id}/cancel`,
    );

    const response = await request(app)
      .patch(`/subscriptions/${created.body.id}/plan`)
      .send({ plan: 'pro' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      'Cannot change plan for a canceled subscription',
    );
  });
});