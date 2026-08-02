import { test, expect } from './support/fixtures';
import { SubscriptionPayloadBuilder } from './support/builders/PayloadBuilder';

test.describe('API Validation', () => {
  test('should create a subscription successfully (trialing)', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.id).toMatch(/^sub_/);
    expect(body.state).toBe('trialing');
    expect(body.plan).toBe('basic');

    const saved = db.getSubscription(body.id);
    expect(saved?.state).toBe('trialing');
  });

  test('should fail to create with unknown plan', async ({ request, serverUrl }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('invalid_plan').build();
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Unknown plan');
  });

  test('should fail to create with missing fields', async ({ request, serverUrl }) => {
    const payload = { customer_id: 'cust_001' }; // Missing plan and payment method
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Missing required fields');
  });

  test('should retrieve an existing subscription', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const response = await request.get(`${serverUrl}/subscriptions/${id}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(id);
  });

  test('should cancel a subscription', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const response = await request.post(`${serverUrl}/subscriptions/${id}/cancel`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.state).toBe('canceled');

    const saved = db.getSubscription(id);
    expect(saved?.state).toBe('canceled');
  });

  test('canceling an already canceled subscription fails', async ({ request, serverUrl }) => {
    const payload = new SubscriptionPayloadBuilder().build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    await request.post(`${serverUrl}/subscriptions/${id}/cancel`);
    const cancelAgain = await request.post(`${serverUrl}/subscriptions/${id}/cancel`);
    expect(cancelAgain.status()).toBe(400);
  });

  test('should change plan for an active subscription', async ({ request, serverUrl, db }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').build();
    const createRes = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    const { id } = await createRes.json();

    const response = await request.post(`${serverUrl}/subscriptions/${id}/change-plan`, { data: { plan: 'pro' } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.plan).toBe('pro');

    const saved = db.getSubscription(id);
    expect(saved?.plan).toBe('pro');
  });

  test('should reject unknown payment method during creation', async ({ request, serverUrl }) => {
    const payload = new SubscriptionPayloadBuilder().withPlan('basic').withPaymentMethod('pm_bad').build();
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid payment method');
  });

  test('should reject unknown customer during creation', async ({ request, serverUrl }) => {
    const payload = new SubscriptionPayloadBuilder().withCustomer('cust_unknown').build();
    const response = await request.post(`${serverUrl}/subscriptions`, { data: payload });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Unknown customer');
  });
});
