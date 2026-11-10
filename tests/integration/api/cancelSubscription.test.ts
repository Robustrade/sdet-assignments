import request from 'supertest';
import { setupTestEnvironment, TestContext } from '../setup';
import { SubscriptionBuilder } from '../../builders/SubscriptionBuilder';

describe('API Integration - POST /subscriptions/:id/cancel', () => {
  let context: TestContext;

  beforeEach(() => {
    context = setupTestEnvironment();
  });

  test('POST /subscriptions/:id/cancel returns 200 and cancels subscription', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .withPlan('pro')
      .active()
      .build();

    await context.subscriptionRepo.save(subscription);

    const response = await request(context.app)
      .post(`/subscriptions/${subscription.id}/cancel`)
      .expect(200);

    expect(response.body.status).toBe('canceled');
    expect(response.body.canceled_at).toBeDefined();
  });

  test('Cancellation persists in database', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .trialing()
      .build();

    await context.subscriptionRepo.save(subscription);

    await request(context.app)
      .post(`/subscriptions/${subscription.id}/cancel`)
      .expect(200);

    // Verify in database
    const updated = await context.subscriptionRepo.findById(subscription.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('canceled');
    expect(updated!.canceled_at).toBeDefined();
  });

  test('Canceling already-canceled subscription is idempotent', async () => {
    const subscription = new SubscriptionBuilder()
      .withCustomerId('cust_001')
      .canceled()
      .build();

    await context.subscriptionRepo.save(subscription);

    // Cancel again
    const response = await request(context.app)
      .post(`/subscriptions/${subscription.id}/cancel`)
      .expect(200);

    expect(response.body.status).toBe('canceled');
  });

  test('POST /subscriptions/:id/cancel returns 404 for non-existent subscription', async () => {
    const response = await request(context.app)
      .post('/subscriptions/sub_nonexistent/cancel')
      .expect(404);

    expect(response.body).toHaveProperty('error');
  });

  test('Can cancel subscription from any non-terminal state', async () => {
    const states = ['trialing', 'active', 'past_due'] as const;

    for (const status of states) {
      const sub = new SubscriptionBuilder()
        .withCustomerId('cust_001')
        .withStatus(status)
        .build();

      await context.subscriptionRepo.save(sub);

      const response = await request(context.app)
        .post(`/subscriptions/${sub.id}/cancel`)
        .expect(200);

      expect(response.body.status).toBe('canceled');
    }
  });
});
