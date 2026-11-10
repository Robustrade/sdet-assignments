// One reusable check: the API, the database and the business rules must all agree.
import { expect } from '@playwright/test';
import { getPayments, getSubscription } from './apiHelper.js';
import { getPaymentsFromDb, getSubscriptionFromDb } from './dbHelper.js';

export async function expectApiAndDbToMatch(request, subscriptionId) {
  const fromApi = await getSubscription(request, subscriptionId);
  const fromDb = getSubscriptionFromDb(subscriptionId);
  expect(fromApi, 'API subscription should equal the DB row').toEqual(fromDb);

  const paymentsFromApi = await getPayments(request, subscriptionId);
  expect(paymentsFromApi, 'API payments should equal the DB rows').toEqual(getPaymentsFromDb(subscriptionId));

  // Business rule: an active subscription must have at least one successful payment saved.
  if (fromDb.status === 'active') {
    expect(paymentsFromApi.some((p) => p.status === 'success'), 'active subscription needs a successful payment').toBe(true);
  }
  return fromDb;
}
