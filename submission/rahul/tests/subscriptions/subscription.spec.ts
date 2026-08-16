import { test, expect } from '../../src/fixtures/apiFixtures';
import { TestData } from '../../src/constants/TestData';

test.describe('Subscription API @regression', () => {
  test('should create a subscription', async ({ subscriptionApi }) => {
    const subscription = {
      userId: 'test-user-id',
      plan: TestData.subscriptionPlans.basic,
    };

    const response = await subscriptionApi.createSubscription(subscription);

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body).toHaveProperty('id');
    expect(body.userId).toBe(subscription.userId);
    expect(body.plan).toBe(subscription.plan);
  });

  test('should get subscriptions', async ({ subscriptionApi }) => {
    const response = await subscriptionApi.getSubscriptions();

    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    expect(body).toBeDefined();
  });

  test('should return 404 for non-existing subscription', async ({
    subscriptionApi,
  }) => {
    const response = await subscriptionApi.getSubscription(
      'non-existing-subscription-id'
    );

    expect(response.status()).toBe(404);
  });
});
