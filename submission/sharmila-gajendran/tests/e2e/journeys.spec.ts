import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS } from '../support/testData';

/**
 * Full journeys through the HTTP API. G1: after every step, `checkpoint` checks the status,
 * compares the API response with the database row, and runs every invariant.
 */
describe('J. end-to-end journeys', () => {
  const ctx = useTestContext();

  it('J1: pro trial -> active -> renewal -> cancel', async () => {
    const { steps, api, clock, dbCheck, providerCheck } = ctx();

    const subscription = await steps.trialingPro();
    await steps.checkpoint(subscription.id, 'trialing');

    await steps.endTrial();
    await steps.checkpoint(subscription.id, 'active');

    await steps.advanceAndBill(BILLING_PERIOD_DAYS);
    await steps.checkpoint(subscription.id, 'active');

    clock.advanceDays(3);
    expect((await api.cancelSubscription(subscription.id)).status).toBe(200);
    await steps.checkpoint(subscription.id, 'canceled');

    expect(dbCheck.auditTrail(subscription.id).map((entry) => [entry.kind, entry.fromStatus, entry.toStatus, entry.trigger])).toEqual([
      ['created', null, 'trialing', 'subscription_created'],
      ['transition', 'trialing', 'active', 'charge_succeeded'],
      ['event', 'active', 'active', 'renewal_succeeded'],
      ['transition', 'active', 'canceled', 'cancel_requested'],
    ]);
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['paid', 'paid']);
    providerCheck.expectChargeCount(2);
  });

  it('J2: basic declined three times ends canceled and stays canceled', async () => {
    const { steps, provider, webhooks, dbCheck, providerCheck } = ctx();
    provider.byDefault('decline');

    const subscription = await steps.create('basic');
    await steps.checkpoint(subscription.id, 'past_due');

    await steps.advanceAndBill(1);
    await steps.checkpoint(subscription.id, 'past_due');

    await steps.advanceAndBill(1);
    await steps.checkpoint(subscription.id, 'canceled');

    // Nothing brings it back: no more billing, and a late success for an old invoice is ignored.
    expect(await steps.advanceAndBill(BILLING_PERIOD_DAYS)).toBe(0);
    const oldInvoice = dbCheck.invoices(subscription.id)[0];
    expect(oldInvoice).toBeDefined();
    if (oldInvoice) {
      const late = await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(oldInvoice).build());
      expect(late.data().outcome).toBe('ignored_stale');
    }
    await steps.checkpoint(subscription.id, 'canceled');
    providerCheck.expectChargeCount(3);
  });

  it('J3: pro trial ends with a decline, a retry succeeds, then the customer cancels', async () => {
    const { steps, provider, api } = ctx();
    const subscription = await steps.trialingPro();

    provider.respondWith('decline');
    await steps.endTrial();
    await steps.checkpoint(subscription.id, 'past_due');

    await steps.advanceAndBill(2);
    await steps.checkpoint(subscription.id, 'active');

    expect((await api.cancelSubscription(subscription.id)).status).toBe(200);
    await steps.checkpoint(subscription.id, 'canceled');
  });
});
