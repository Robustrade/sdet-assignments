import { test, expect } from '@playwright/test';
import { createCustomer, createSubscription, expectApiMatchesDb, paymentsInDb, subscribe, subscriptionsOfCustomerInDb } from '../helpers.js';

test('basic plan: free trial, no payment taken', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'basic');

  expect(subscription.status).toBe('trialing');
  await expectApiMatchesDb(request, subscription.id);
  expect(paymentsInDb(subscription.id)).toHaveLength(0);
});

test('pro plan: charged 4900 once and becomes active', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'pro');

  expect(subscription.status).toBe('active');
  await expectApiMatchesDb(request, subscription.id);
  const payments = paymentsInDb(subscription.id);
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ amount: 4900, status: 'success' });
});

test('unknown plan: 400 error and nothing saved', async ({ request }) => {
  const customer = await createCustomer(request);

  const response = await subscribe(request, customer.id, 'gold');

  expect(response.status()).toBe(400);
  expect(subscriptionsOfCustomerInDb(customer.id)).toHaveLength(0);
});
