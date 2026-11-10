import { test, expect } from '@playwright/test';
import { CARDS, PLANS, PRO_PRICE } from '../test-data/testData.js';
import {
  cancelSubscription, changeCard, createCustomer, createSubscription,
  getPayments, getSubscription, retryPayment, sendWebhook, subscribe,
} from '../api/subscriptionApi.js';
import { paymentsInDb, subscriptionInDb, subscriptionsOfCustomerInDb } from '../db/dbHelper.js';
import { SubscriptionPage } from '../pages/SubscriptionPage.js';

// The main check: what the API returns must be the same as what is saved in the database.
async function expectApiMatchesDb(request, subscriptionId) {
  const fromApi = await getSubscription(request, subscriptionId);
  const fromDb = subscriptionInDb(subscriptionId);
  expect(fromApi).toEqual(fromDb);
  expect(await getPayments(request, subscriptionId)).toEqual(paymentsInDb(subscriptionId));
  return fromDb;
}

test.describe('Create subscription', () => {
  test('basic plan: free trial, no payment taken', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.basic);

    expect(subscription.status).toBe('trialing');
    await expectApiMatchesDb(request, subscription.id);
    expect(paymentsInDb(subscription.id)).toHaveLength(0);
  });

  test('pro plan: charged once and becomes active', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro);

    expect(subscription.status).toBe('active');
    await expectApiMatchesDb(request, subscription.id);
    const payments = paymentsInDb(subscription.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: PRO_PRICE, status: 'success' });
  });

  test('unknown plan: 400 error and nothing saved', async ({ request }) => {
    const customer = await createCustomer(request);

    const response = await subscribe(request, customer.id, PLANS.unknown);

    expect(response.status()).toBe(400);
    expect(subscriptionsOfCustomerInDb(customer.id)).toHaveLength(0);
  });
});

test.describe('Duplicate requests', () => {
  test('same request sent twice (same Idempotency-Key): one subscription, one payment', async ({ request }) => {
    const customer = await createCustomer(request);
    const key = `key-${customer.id}`;

    const first = await subscribe(request, customer.id, PLANS.pro, key);
    const second = await subscribe(request, customer.id, PLANS.pro, key);

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    const subscription = await first.json();
    expect((await second.json()).id).toBe(subscription.id);
    expect(subscriptionsOfCustomerInDb(customer.id)).toHaveLength(1);
    expect(paymentsInDb(subscription.id)).toHaveLength(1);
  });

  test('same webhook sent twice: processed only once', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro, CARDS.timeout); // payment left pending
    const [payment] = await getPayments(request, subscription.id);
    const eventId = `evt_${payment.id}`; // the same event id is sent twice

    const first = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id, eventId);
    const second = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id, eventId);

    expect(await first.json()).toEqual({ result: 'processed' });
    expect(await second.json()).toEqual({ result: 'duplicate' });
    expect(subscriptionInDb(subscription.id).status).toBe('active');
  });
});

test.describe('Payment failures and retry', () => {
  test('declined card: subscription becomes past_due and the failed payment is saved', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro, CARDS.declined);

    expect(subscription.status).toBe('past_due');
    await expectApiMatchesDb(request, subscription.id);
    expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['failed']);
  });

  test('retry after the customer changes the card: subscription becomes active', async ({ request }) => {
    const { customer, subscription } = await createSubscription(request, PLANS.pro, CARDS.declined);

    await changeCard(request, customer.id, CARDS.ok);
    const retry = await retryPayment(request, subscription.id);

    expect(retry.status()).toBe(200);
    expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
    expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['failed', 'success']);
  });

  test('gateway timeout: payment stays pending, no double charge, webhook completes it', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro, CARDS.timeout);

    await test.step('after the timeout nothing is guessed: payment and subscription stay pending', async () => {
      expect(subscription.status).toBe('pending');
      expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['pending']);
    });

    await test.step('charging again is refused, so the customer cannot be charged twice', async () => {
      const secondCharge = await retryPayment(request, subscription.id);
      expect(secondCharge.status()).toBe(409);
      expect(paymentsInDb(subscription.id)).toHaveLength(1);
    });

    await test.step('the gateway confirms by webhook: subscription becomes active', async () => {
      const [payment] = await getPayments(request, subscription.id);
      await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);
      expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
    });
  });
});

test.describe('Late and wrong-order webhooks', () => {
  test('late webhook after cancel: ignored, subscription stays canceled', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro, CARDS.timeout);
    const [payment] = await getPayments(request, subscription.id);
    await cancelSubscription(request, subscription.id);

    const response = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);

    expect(await response.json()).toEqual({ result: 'ignored: subscription is canceled' });
    expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('canceled');
  });

  test('"failed" arriving after "succeeded": ignored, the payment is not undone', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.pro, CARDS.timeout);
    const [payment] = await getPayments(request, subscription.id);

    await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);
    const lateFailure = await sendWebhook(request, 'payment.failed', subscription.id, payment.id);

    expect(await lateFailure.json()).toEqual({ result: 'ignored: payment is already success' });
    expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
    expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['success']);
  });

  test('cancel twice: second cancel is refused with 409', async ({ request }) => {
    const { subscription } = await createSubscription(request, PLANS.basic);

    expect((await cancelSubscription(request, subscription.id)).status()).toBe(200);
    expect((await cancelSubscription(request, subscription.id)).status()).toBe(409);
    expect(subscriptionInDb(subscription.id).status).toBe('canceled');
  });
});

// End-to-end: the user clicks in the browser, then we check the API and the database.
test.describe('End-to-end: UI → API → database', () => {
  test('user subscribes to pro with a working card: page, API and database all say active', async ({ page, request }) => {
    const subscriptionPage = new SubscriptionPage(page);

    await subscriptionPage.open();
    await subscriptionPage.subscribe(PLANS.pro, CARDS.ok);

    await expect(subscriptionPage.status).toHaveText('active');
    const subscriptionId = await subscriptionPage.subscriptionId.textContent();
    expect((await expectApiMatchesDb(request, subscriptionId)).status).toBe('active');
    expect(paymentsInDb(subscriptionId)).toMatchObject([{ amount: PRO_PRICE, status: 'success' }]);
  });

  test('user subscribes with a declined card: page shows past_due, failed payment saved', async ({ page, request }) => {
    const subscriptionPage = new SubscriptionPage(page);

    await subscriptionPage.open();
    await subscriptionPage.subscribe(PLANS.pro, CARDS.declined);

    await expect(subscriptionPage.status).toHaveText('past_due');
    const subscriptionId = await subscriptionPage.subscriptionId.textContent();
    expect((await expectApiMatchesDb(request, subscriptionId)).status).toBe('past_due');
    expect(paymentsInDb(subscriptionId).map((p) => p.status)).toEqual(['failed']);
  });

  test('user cancels from the page: canceled in the page and in the database', async ({ page, request }) => {
    const subscriptionPage = new SubscriptionPage(page);

    await subscriptionPage.open();
    await subscriptionPage.subscribe(PLANS.basic, CARDS.ok);
    await expect(subscriptionPage.status).toHaveText('trialing');
    await subscriptionPage.cancel();

    await expect(subscriptionPage.status).toHaveText('canceled');
    const subscriptionId = await subscriptionPage.subscriptionId.textContent();
    expect((await expectApiMatchesDb(request, subscriptionId)).status).toBe('canceled');
  });
});
