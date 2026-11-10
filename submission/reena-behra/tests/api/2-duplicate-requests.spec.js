import { test, expect } from '@playwright/test';
import { createCustomer, createSubscription, getPayments, paymentsInDb, sendWebhook, subscribe, subscriptionInDb, subscriptionsOfCustomerInDb } from '../helpers.js';

test('same request sent twice (same Idempotency-Key): one subscription, one payment', async ({ request }) => {
  const customer = await createCustomer(request);
  const key = `key-${customer.id}`;

  const first = await subscribe(request, customer.id, 'pro', key);
  const second = await subscribe(request, customer.id, 'pro', key);

  expect(first.status()).toBe(201);
  expect(second.status()).toBe(200);
  const subscription = await first.json();
  expect((await second.json()).id).toBe(subscription.id);
  expect(subscriptionsOfCustomerInDb(customer.id)).toHaveLength(1);
  expect(paymentsInDb(subscription.id)).toHaveLength(1);
});

test('same webhook sent twice: processed only once', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'pro', 'card_timeout'); // payment left pending
  const [payment] = await getPayments(request, subscription.id);

  const eventId = `evt_${payment.id}`; // the same event id is sent twice
  const first = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id, eventId);
  const second = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id, eventId);

  expect(await first.json()).toEqual({ result: 'processed' });
  expect(await second.json()).toEqual({ result: 'duplicate' });
  expect(subscriptionInDb(subscription.id).status).toBe('active');
});
