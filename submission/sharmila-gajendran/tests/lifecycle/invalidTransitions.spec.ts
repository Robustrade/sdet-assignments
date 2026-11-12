import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS } from '../support/testData';

describe('E. transitions that must never happen', () => {
  const ctx = useTestContext();

  /** An active subscription with a renewal waiting for a webhook, then canceled by the customer. */
  async function canceledWithPendingRenewal() {
    const { steps, provider, api, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    provider.respondWith('pending');
    await steps.advanceAndBill(BILLING_PERIOD_DAYS);
    const renewal = dbCheck.pendingInvoice(subscription.id);
    expect((await api.cancelSubscription(subscription.id)).status).toBe(200);
    return { subscription, renewal };
  }

  it('E2: a payment.succeeded webhook cannot bring a canceled subscription back to active', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, renewal } = await canceledWithPendingRenewal();
    const before = dbCheck.snapshot(subscription.id);
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(renewal).build();

    const response = await webhooks.deliver(event);

    expect(response.status).toBe(200);
    expect(response.data().outcome).toBe('ignored_invalid_transition');
    expect(await steps.statusOf(subscription.id)).toBe('canceled');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
    expect(dbCheck.webhookEvent(event.event_id)?.outcome).toBe('ignored_invalid_transition');
  });

  it('a payment.failed webhook does not move a canceled subscription either', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, renewal } = await canceledWithPendingRenewal();
    const before = dbCheck.snapshot(subscription.id);

    const response = await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(renewal).build());

    expect(response.data().outcome).toBe('ignored_invalid_transition');
    expect(await steps.statusOf(subscription.id)).toBe('canceled');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });

  it('E3: cancelling a past_due subscription through the API returns 409 and changes nothing', async () => {
    const { steps, api, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic();
    const before = dbCheck.snapshot(subscription.id);

    const response = await api.cancelSubscription(subscription.id);

    expect(response.status).toBe(409);
    expect(response.errorCode()).toBe('INVALID_TRANSITION');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });

  it('B5: cancelling twice returns 409 and keeps the first cancellation', async () => {
    const { steps, api, clock, dbCheck } = ctx();
    const subscription = await steps.trialingPro();
    const first = await api.cancelSubscription(subscription.id);
    clock.advanceDays(1);
    const before = dbCheck.snapshot(subscription.id);

    const second = await api.cancelSubscription(subscription.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.errorCode()).toBe('INVALID_TRANSITION');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
    expect(dbCheck.subscription(subscription.id).canceledAt).toBe(first.data().canceled_at);
  });

  it('a canceled subscription is never billed again', async () => {
    const { steps, api, providerCheck } = ctx();
    const subscription = await steps.activeBasic();
    await api.cancelSubscription(subscription.id);

    const attempted = await steps.advanceAndBill(BILLING_PERIOD_DAYS * 3);

    expect(attempted).toBe(0);
    providerCheck.expectChargeCount(1);
    expect(await steps.statusOf(subscription.id)).toBe('canceled');
  });
});
