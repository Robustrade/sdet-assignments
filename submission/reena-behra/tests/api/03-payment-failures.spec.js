// Declined payments, retries, and a gateway that doesn't answer (partial failure).
import { test, expect } from '@playwright/test';
import { chargeSubscription, createCustomerWithSubscription, getGatewayCalls, getPayments, updateCard } from '../helpers/apiHelper.js';
import { getPaymentsFromDb, getStatusHistoryFromDb } from '../helpers/dbHelper.js';
import { buildPaymentEvent, sendWebhook } from '../helpers/webhookHelper.js';
import { expectApiAndDbToMatch } from '../helpers/consistencyCheck.js';
import { CARDS } from '../helpers/testData.js';

test.describe('Payment failures and retries', () => {
  test('declined card: subscription becomes past_due and a failed payment is saved', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.declined });

    expect(subscription.status).toBe('past_due');
    await expectApiAndDbToMatch(request, subscription.id);
    const payments = getPaymentsFromDb(subscription.id);
    expect(payments.map((p) => p.status)).toEqual(['failed']); // no fake "success" row
  });

  test('retry after the customer updates the card: subscription becomes active', async ({ request }) => {
    const { customer, subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.declined });

    await updateCard(request, customer.id, CARDS.ok);
    const retry = await chargeSubscription(request, subscription.id);

    expect(retry.status()).toBe(200);
    await expectApiAndDbToMatch(request, subscription.id);
    expect(getPaymentsFromDb(subscription.id).map((p) => p.status)).toEqual(['failed', 'success']);
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'past_due', 'active']);

    // Each attempt uses its own idempotency key, so the gateway can tell a retry from a duplicate.
    const keys = (await getGatewayCalls(request, subscription.id)).map((call) => call.idempotencyKey);
    expect(keys).toEqual([`${subscription.id}-attempt-1`, `${subscription.id}-attempt-2`]);
  });

  test('three failed payments: subscription is canceled and no more charges are allowed', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.declined });

    await chargeSubscription(request, subscription.id); // 2nd failure
    await chargeSubscription(request, subscription.id); // 3rd failure
    const fourthTry = await chargeSubscription(request, subscription.id);

    expect(fourthTry.status()).toBe(409);
    const saved = await expectApiAndDbToMatch(request, subscription.id);
    expect(saved.status).toBe('canceled');
    expect(getPaymentsFromDb(subscription.id)).toHaveLength(3);
    expect(await getGatewayCalls(request, subscription.id)).toHaveLength(3);
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'past_due', 'canceled']);
  });

  test('gateway timeout (partial failure): payment stays pending, a later webhook completes it', async ({ request }) => {
    const { subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.timeout });

    await test.step('after the timeout we do not pretend it succeeded or failed', async () => {
      expect(subscription.status).toBe('trialing');
      expect(getPaymentsFromDb(subscription.id).map((p) => p.status)).toEqual(['pending']);
      await expectApiAndDbToMatch(request, subscription.id);
    });

    await test.step('gateway later confirms the payment by webhook', async () => {
      const [payment] = await getPayments(request, subscription.id);
      await sendWebhook(request, buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: payment.id }));

      const saved = await expectApiAndDbToMatch(request, subscription.id);
      expect(saved.status).toBe('active');
      expect(getPaymentsFromDb(subscription.id).map((p) => p.status)).toEqual(['success']);
      expect(await getGatewayCalls(request, subscription.id)).toHaveLength(1); // never charged twice
    });
  });
});
