// One full customer story, checking the API and the database after EVERY step.
import { test, expect } from '@playwright/test';
import { cancelSubscription, chargeSubscription, createCustomerWithSubscription, getGatewayCalls, getPayments, updateCard } from '../helpers/apiHelper.js';
import { getPaymentsFromDb, getStatusHistoryFromDb } from '../helpers/dbHelper.js';
import { buildPaymentEvent, sendWebhook } from '../helpers/webhookHelper.js';
import { expectApiAndDbToMatch } from '../helpers/consistencyCheck.js';
import { CARDS, PLAN_PRICE } from '../helpers/testData.js';

test('customer journey: declined → card updated → paid → duplicate webhook → canceled → late webhook ignored', async ({ request }) => {
  let customer;
  let subscription;

  await test.step('1. sign up with a card that gets declined → past_due', async () => {
    ({ customer, subscription } = await createCustomerWithSubscription(request, { plan: 'pro', card: CARDS.declined }));
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('past_due');
  });

  await test.step('2. customer updates the card and payment is retried → active', async () => {
    await updateCard(request, customer.id, CARDS.ok);
    await chargeSubscription(request, subscription.id);
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('active');
    expect(getPaymentsFromDb(subscription.id).map((p) => [p.status, p.amount])).toEqual([
      ['failed', PLAN_PRICE.pro],
      ['success', PLAN_PRICE.pro],
    ]);
  });

  await test.step('3. gateway sends a duplicate/late webhook for the paid attempt → nothing changes', async () => {
    const payments = await getPayments(request, subscription.id);
    const event = buildPaymentEvent({ type: 'payment.succeeded', subscriptionId: subscription.id, paymentId: payments[1].id });
    await sendWebhook(request, event);
    await sendWebhook(request, event);
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('active');
    expect(getPaymentsFromDb(subscription.id)).toHaveLength(2);
  });

  await test.step('4. customer cancels → canceled', async () => {
    expect((await cancelSubscription(request, subscription.id)).status()).toBe(200);
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('canceled');
  });

  await test.step('5. a late failure webhook and a charge attempt after cancel change nothing', async () => {
    const payments = await getPayments(request, subscription.id);
    await sendWebhook(request, buildPaymentEvent({ type: 'payment.failed', subscriptionId: subscription.id, paymentId: payments[1].id }));
    expect((await chargeSubscription(request, subscription.id)).status()).toBe(409);
    expect((await expectApiAndDbToMatch(request, subscription.id)).status).toBe('canceled');
  });

  await test.step('6. audit trail and gateway calls tell the same story', async () => {
    expect(getStatusHistoryFromDb(subscription.id)).toEqual(['trialing', 'past_due', 'active', 'canceled']);
    expect(await getGatewayCalls(request, subscription.id)).toHaveLength(2); // one decline + one success, nothing extra
  });
});
