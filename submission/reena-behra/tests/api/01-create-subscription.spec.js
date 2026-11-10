// Creating a subscription: check the API response, the database, and the payment gateway.
import { test, expect } from '@playwright/test';
import { createCustomer, createCustomerWithSubscription, getGatewayCalls, getGatewayCallsForCustomer } from '../helpers/apiHelper.js';
import { getPaymentsFromDb, getStatusHistoryFromDb, getSubscriptionsOfCustomerFromDb } from '../helpers/dbHelper.js';
import { expectApiAndDbToMatch } from '../helpers/consistencyCheck.js';
import { PLAN_PRICE } from '../helpers/testData.js';

test.describe('Create subscription', () => {
  test('basic plan starts a free trial: no payment is taken', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'basic' });

    expect(subscription.status).toBe('trialing');
    await expectApiAndDbToMatch(request, subscription.id);
    expect(getPaymentsFromDb(subscription.id)).toHaveLength(0);
    expect(await getGatewayCalls(request, subscription.id)).toHaveLength(0);
  });

  test('pro plan is charged once at signup and becomes active', async ({ request }) => {
    const { customer, subscription } = await createCustomerWithSubscription(request, { plan: 'pro' });

    expect(subscription.status).toBe('active');
    await expectApiAndDbToMatch(request, subscription.id);

    // Database: exactly one successful payment for the right amount
    const payments = getPaymentsFromDb(subscription.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'success', amount: PLAN_PRICE.pro, attempt_no: 1 });

    // Gateway: called once, with the right customer and amount
    const calls = await getGatewayCalls(request, subscription.id);
    expect(calls).toEqual([
      { subscriptionId: subscription.id, customerId: customer.id, card: customer.card, amount: PLAN_PRICE.pro, idempotencyKey: `${subscription.id}-attempt-1` },
    ]);

    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'active']);
  });

  const invalidRequests = [
    { name: 'unknown plan', body: (customerId) => ({ customerId, plan: 'gold' }), status: 400 },
    { name: 'missing plan', body: (customerId) => ({ customerId }), status: 400 },
    { name: 'unknown customer', body: () => ({ customerId: 'cus_does_not_exist', plan: 'pro' }), status: 404 },
  ];

  for (const invalid of invalidRequests) {
    test(`rejects ${invalid.name}: error returned, nothing saved, nobody charged`, async ({ request }) => {
      const customer = await createCustomer(request);

      const response = await request.post('/subscriptions', { data: invalid.body(customer.id) });

      expect(response.status()).toBe(invalid.status);
      expect((await response.json()).error).toBeTruthy();
      expect(getSubscriptionsOfCustomerFromDb(customer.id)).toHaveLength(0);
      expect(await getGatewayCallsForCustomer(request, customer.id)).toHaveLength(0);
    });
  }

  test('unknown subscription id returns 404', async ({ request }) => {
    const response = await request.get('/subscriptions/sub_does_not_exist');
    expect(response.status()).toBe(404);
  });
});
