import { test, expect } from '@playwright/test';
import { createSubscription, expectApiMatchesDb, getPayments, paymentsInDb, sendWebhook, subscriptionInDb } from '../helpers.js';

// A pro subscription whose payment is pending, waiting for the gateway's webhook.
async function subscriptionWaitingForWebhook(request) {
  const { subscription } = await createSubscription(request, 'pro', 'card_timeout');
  const [payment] = await getPayments(request, subscription.id);
  return { subscription, payment };
}

test('late webhook after cancel: ignored, subscription stays canceled', async ({ request }) => {
  const { subscription, payment } = await subscriptionWaitingForWebhook(request);
  await request.post(`/subscriptions/${subscription.id}/cancel`);

  const response = await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);

  expect(await response.json()).toEqual({ result: 'ignored: subscription is canceled' });
  expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('canceled');
});

test('"failed" arriving after "succeeded": ignored, the payment is not undone', async ({ request }) => {
  const { subscription, payment } = await subscriptionWaitingForWebhook(request);

  await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);
  const lateFailure = await sendWebhook(request, 'payment.failed', subscription.id, payment.id);

  expect(await lateFailure.json()).toEqual({ result: 'ignored: payment is already success' });
  expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
  expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['success']);
});

test('cancel twice: second cancel is refused with 409', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'basic');

  expect((await request.post(`/subscriptions/${subscription.id}/cancel`)).status()).toBe(200);
  expect((await request.post(`/subscriptions/${subscription.id}/cancel`)).status()).toBe(409);
  expect(subscriptionInDb(subscription.id).status).toBe('canceled');
});
