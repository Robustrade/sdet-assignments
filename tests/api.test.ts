import request from 'supertest';
import { Express } from 'express';
import { buildApp } from '../src/api/app';
import { MockPaymentProvider } from '../src/infra/MockPaymentProvider';
import { SubscriptionBuilder } from '../src/testing/builders/SubscriptionBuilder';

describe('API contract & validation', () => {
  let provider: MockPaymentProvider;
  let app: Express;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    ({ app } = buildApp(provider));
  });

  test('creates a subscription in trialing state, no charge on creation', async () => {
    const body = new SubscriptionBuilder().build();
    const res = await request(app).post('/subscriptions').send(body);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('trialing');
    expect(provider.callCount()).toBe(0);
  });

  test('rejects an unknown plan and does not call the provider', async () => {
    const body = new SubscriptionBuilder().withPlan('enterprise-deluxe').build();
    const res = await request(app).post('/subscriptions').send(body);

    expect(res.status).toBe(400);
    expect(provider.callCount()).toBe(0);
  });

  test('rejects a missing payment method', async () => {
    const body = new SubscriptionBuilder().withoutPaymentMethod().build();
    const res = await request(app).post('/subscriptions').send(body);
    expect(res.status).toBe(400);
  });

  test('rejects a missing customer id', async () => {
    const body = new SubscriptionBuilder().withCustomer('').build();
    const res = await request(app).post('/subscriptions').send(body);
    expect(res.status).toBe(400);
  });

  test('retrieves a created subscription by id', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    const res = await request(app).get(`/subscriptions/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  test('returns 404 for an unknown subscription id', async () => {
    const res = await request(app).get('/subscriptions/sub_does_not_exist');
    expect(res.status).toBe(404);
  });

  test('cancels a trialing subscription', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    const res = await request(app).post(`/subscriptions/${created.body.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('canceled');
  });

  test('rejects canceling an already-canceled subscription', async () => {
    const created = await request(app).post('/subscriptions').send(new SubscriptionBuilder().build());
    await request(app).post(`/subscriptions/${created.body.id}/cancel`);
    const res = await request(app).post(`/subscriptions/${created.body.id}/cancel`);
    expect(res.status).toBe(409);
  });
});
