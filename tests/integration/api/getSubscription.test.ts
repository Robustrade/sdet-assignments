import request from 'supertest';
import { setupTestEnvironment, TestContext } from '../setup';
import { SubscriptionBuilder } from '../../builders/SubscriptionBuilder';

describe('API Integration - GET /subscriptions/:id', () => {
  let context: TestContext;

  beforeEach(() => {
    context = setupTestEnvironment();
  });

  test('GET /subscriptions/:id returns 200 for existing subscription', async () => {
    // Create a subscription
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .withPlan('pro')
      .trialing()
      .build();

    await context.subscriptionRepo.save(subscription);

    // Get the subscription
    const response = await request(context.app)
      .get(`/subscriptions/${subscription.id}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: subscription.id,
      customer_id: 'cust_001',
      plan: 'pro',
      status: 'trialing'
    });
  });

  test('GET /subscriptions/:id returns 404 for non-existent subscription', async () => {
    const response = await request(context.app)
      .get('/subscriptions/sub_nonexistent')
      .expect(404);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('not found');
  });

  test('GET /subscriptions/:id returns subscription with all fields', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_002')
      .withPlan('basic')
      .active()
      .build();

    await context.subscriptionRepo.save(subscription);

    const response = await request(context.app)
      .get(`/subscriptions/${subscription.id}`)
      .expect(200);

    expect(response.body.id).toBeDefined();
    expect(response.body.customer_id).toBeDefined();
    expect(response.body.plan).toBeDefined();
    expect(response.body.status).toBeDefined();
    expect(response.body.payment_method_id).toBeDefined();
    expect(response.body.created_at).toBeDefined();
  });
});
