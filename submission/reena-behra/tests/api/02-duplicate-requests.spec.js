// The same request or event arriving twice must only have an effect ONCE.
import { test, expect } from '@playwright/test';
import { chargeSubscription, createCustomer, createCustomerWithSubscription, createSubscription, getGatewayCalls, getPayments } from '../helpers/apiHelper.js';
import { getPaymentsFromDb, getStatusHistoryFromDb, getSubscriptionsOfCustomerFromDb, getWebhookEventFromDb } from '../helpers/dbHelper.js';
import { buildPaymentEvent, sendWebhook } from '../helpers/webhookHelper.js';
import { expectApiAndDbToMatch } from '../helpers/consistencyCheck.js';
import { CARDS } from '../helpers/testData.js';

test.describe('Duplicate requests and events', () => {
  test('same create request sent twice (same Idempotency-Key): one subscription, one charge', async ({ request }) => {
    const customer = await createCustomer(request);
    const idempotencyKey = `signup-${customer.id}`;

    const first = await createSubscription(request, { customerId: customer.id, plan: 'pro', idempotencyKey });
    const second = await createSubscription(request, { customerId: customer.id, plan: 'pro', idempotencyKey });

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    const subscription = await first.json();
    expect((await second.json()).id).toBe(subscription.id);

    expect(getSubscriptionsOfCustomerFromDb(customer.id)).toHaveLength(1);
    expect(getPaymentsFromDb(subscription.id)).toHaveLength(1);
    expect(await getGatewayCalls(request, subscription.id)).toHaveLength(1);
  });

  test('same webhook event delivered twice: processed once, second is counted as a duplicate', async ({ request }) => {
    // A timeout leaves the payment "pending", waiting for the gateway's webhook.
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.timeout });
    const [pendingPayment] = await getPayments(request, subscription.id);
    const event = buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: pendingPayment.id });

    const first = await sendWebhook(request, event);
    const second = await sendWebhook(request, event);

    expect(await first.json()).toEqual({ result: 'processed' });
    expect(await second.json()).toEqual({ result: 'duplicate' });
    expect(getWebhookEventFromDb(event.eventId)).toMatchObject({ result: 'processed', received_count: 2 });
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'active']); // changed only once
    await expectApiAndDbToMatch(request, subscription.id);
  });

  test('charge clicked twice while the first payment is still pending: customer is charged once', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.timeout });

    const secondCharge = await chargeSubscription(request, subscription.id);

    expect(secondCharge.status()).toBe(409);
    expect(getPaymentsFromDb(subscription.id)).toHaveLength(1);
    expect(await getGatewayCalls(request, subscription.id)).toHaveLength(1);
  });
});
