import request from 'supertest';
import { setupTestEnvironment, TestContext } from '../setup';
import { CreateSubscriptionRequest } from '../../../src/domain/subscription/types';

describe('API Integration - POST /subscriptions', () => {
  let context: TestContext;

  beforeEach(() => {
    context = setupTestEnvironment();
  });

  test('POST /subscriptions returns 201 with valid data', async () => {
    const payload: CreateSubscriptionRequest = {
      customer_id: 'cust_001',
      plan: 'pro',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(201);

    expect(response.body).toMatchObject({
      customer_id: 'cust_001',
      plan: 'pro',
      status: 'trialing',
      payment_method_id: 'pm_test_001'
    });
    expect(response.body.id).toBeDefined();
    expect(response.body.created_at).toBeDefined();
    expect(response.body.trial_end_at).toBeDefined();
  });

  test('POST /subscriptions returns 400 for invalid plan', async () => {
    const payload: any = {
      customer_id: 'cust_001',
      plan: 'invalid_plan',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Invalid plan');
  });

  test('POST /subscriptions returns 400 for missing customer_id', async () => {
    const payload = {
      plan: 'pro',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('customer_id is required');
  });

  test('POST /subscriptions returns 400 for missing plan', async () => {
    const payload = {
      customer_id: 'cust_001',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('plan is required');
  });

  test('Subscription starts in trialing state', async () => {
    const payload: CreateSubscriptionRequest = {
      customer_id: 'cust_001',
      plan: 'basic',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(201);

    expect(response.body.status).toBe('trialing');

    // Verify in database
    const subscription = await context.subscriptionRepo.findById(response.body.id);
    expect(subscription).toBeDefined();
    expect(subscription!.status).toBe('trialing');
  });

  test('Subscription has correct trial period for plan', async () => {
    const payload: CreateSubscriptionRequest = {
      customer_id: 'cust_001',
      plan: 'pro',
      payment_method_id: 'pm_test_001'
    };

    const response = await request(context.app)
      .post('/subscriptions')
      .send(payload)
      .expect(201);

    const trialEndDate = new Date(response.body.trial_end_at);
    const createdDate = new Date(response.body.created_at);

    // Pro plan has 14 day trial
    const daysDifference = Math.round((trialEndDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDifference).toBe(14);
  });
});
