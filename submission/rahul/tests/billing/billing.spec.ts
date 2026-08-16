import { test, expect } from '../../src/fixtures/apiFixtures';
import { DataGenerator } from '../../src/utils/DataGenerator';

test.describe('Billing API @regression', () => {
  test('should create a billing record', async ({ billingApi }) => {
    const billing = {
      userId: 'test-user-id',
      subscriptionId: 'test-subscription-id',
      amount: DataGenerator.randomAmount(),
      currency: 'USD',
    };

    const response = await billingApi.createBilling(billing);

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body).toHaveProperty('id');
    expect(body.userId).toBe(billing.userId);
    expect(body.subscriptionId).toBe(billing.subscriptionId);
    expect(body.amount).toBe(billing.amount);
    expect(body.currency).toBe(billing.currency);
  });

  test('should get billing records', async ({ billingApi }) => {
    const response = await billingApi.getBillingRecords();

    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    expect(body).toBeDefined();
  });

  test('should return 404 for non-existing billing record', async ({
    billingApi,
  }) => {
    const response = await billingApi.getBillingRecord(
      'non-existing-billing-id'
    );

    expect(response.status()).toBe(404);
  });
});
