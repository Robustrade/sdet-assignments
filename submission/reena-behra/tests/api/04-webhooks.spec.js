// Webhooks that are fake, late, or arrive in the wrong order must not corrupt data.
import { test, expect } from '@playwright/test';
import { cancelSubscription, createCustomerWithSubscription, getPayments } from '../helpers/apiHelper.js';
import { getPaymentsFromDb, getStatusHistoryFromDb, getWebhookEventFromDb, getWebhookEventsOfSubscriptionFromDb } from '../helpers/dbHelper.js';
import { buildPaymentEvent, sendWebhook, sendWebhookWithWrongSignature } from '../helpers/webhookHelper.js';
import { expectApiAndDbToMatch } from '../helpers/consistencyCheck.js';
import { CARDS } from '../helpers/testData.js';

// Helper for this file: a pro subscription whose payment is pending (waiting for a webhook).
async function subscriptionWaitingForWebhook(request) {
  const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.timeout });
  const [payment] = await getPayments(request, subscription.id);
  return { subscription, payment };
}

test.describe('Webhook handling', () => {
  test('webhook with a wrong signature is rejected and nothing is saved', async ({ request }) => {
    const { subscription, payment } = await subscriptionWaitingForWebhook(request);
    const event = buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: payment.id });

    const response = await sendWebhookWithWrongSignature(request, event);

    expect(response.status()).toBe(401);
    expect(getWebhookEventFromDb(event.eventId)).toBeUndefined();
    expect(getPaymentsFromDb(subscription.id)[0].status).toBe('pending');
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('trialing');
  });

  test('webhook with missing fields is rejected with 400', async ({ request }) => {
    const response = await sendWebhook(request, { eventId: 'evt_incomplete', type: 'payment.succeeded' });
    expect(response.status()).toBe(400);
    expect(getWebhookEventFromDb('evt_incomplete')).toBeUndefined();
  });

  test('late success webhook after cancel does not bring the subscription back', async ({ request }) => {
    const { subscription, payment } = await subscriptionWaitingForWebhook(request);
    await cancelSubscription(request, subscription.id);

    const response = await sendWebhook(request, buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: payment.id }));

    expect(await response.json()).toEqual({ result: 'ignored', reason: 'subscription is canceled' });
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('canceled');
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'canceled']);
    expect(getWebhookEventsOfSubscriptionFromDb(subscription.id)[0]).toMatchObject({ result: 'ignored' }); // still recorded for audit
  });

  test('out of order: "failed" arriving after "succeeded" does not undo the payment', async ({ request }) => {
    const { subscription, payment } = await subscriptionWaitingForWebhook(request);

    await sendWebhook(request, buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: payment.id }));
    const lateFailure = await sendWebhook(request, buildPaymentEvent({ type: 'payment.failed', subscriptionId: subscription.id, paymentId: payment.id }));

    expect(await lateFailure.json()).toEqual({ result: 'ignored', reason: 'payment is already success' });
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('active');
    expect(getPaymentsFromDb(subscription.id).map((p) => p.status)).toEqual(['success']);
  });

  test('canceling twice: second cancel returns 409 and changes nothing', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'basic' });

    expect((await cancelSubscription(request, subscription.id)).status()).toBe(200);
    expect((await cancelSubscription(request, subscription.id)).status()).toBe(409);
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'canceled']);
  });
});
