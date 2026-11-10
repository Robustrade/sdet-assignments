import { test, expect } from '@playwright/test';
import { createSubscription, expectApiMatchesDb, getPayments, paymentsInDb, sendWebhook } from '../helpers.js';

test('declined card: subscription becomes past_due and the failed payment is saved', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'pro', 'card_declined');

  expect(subscription.status).toBe('past_due');
  await expectApiMatchesDb(request, subscription.id);
  expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['failed']);
});

test('retry after the customer changes the card: subscription becomes active', async ({ request }) => {
  const { customer, subscription } = await createSubscription(request, 'pro', 'card_declined');

  await request.put(`/customers/${customer.id}/card`, { data: { card: 'card_ok' } });
  const retry = await request.post(`/subscriptions/${subscription.id}/charge`);

  expect(retry.status()).toBe(200);
  expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
  expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['failed', 'success']);
});

test('gateway timeout: payment stays pending, no double charge, webhook completes it', async ({ request }) => {
  const { subscription } = await createSubscription(request, 'pro', 'card_timeout');

  await test.step('after the timeout nothing is guessed: payment and subscription stay pending', async () => {
    expect(subscription.status).toBe('pending');
    expect(paymentsInDb(subscription.id).map((p) => p.status)).toEqual(['pending']);
  });

  await test.step('charging again is refused, so the customer cannot be charged twice', async () => {
    const secondCharge = await request.post(`/subscriptions/${subscription.id}/charge`);
    expect(secondCharge.status()).toBe(409);
    expect(paymentsInDb(subscription.id)).toHaveLength(1);
  });

  await test.step('the gateway confirms by webhook: subscription becomes active', async () => {
    const [payment] = await getPayments(request, subscription.id);
    await sendWebhook(request, 'payment.succeeded', subscription.id, payment.id);
    expect((await expectApiMatchesDb(request, subscription.id)).status).toBe('active');
  });
});
