import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS, MAX_FAILED_ATTEMPTS } from '../support/testData';
import { daysAfter } from '../support/time';

describe('C. payment outcomes', () => {
  const ctx = useTestContext();

  it('C1: a declined card on create leaves basic past_due with a failed invoice and no paid one', async () => {
    const { steps, dbCheck } = ctx();

    const subscription = await steps.pastDueBasic();

    expect(subscription.current_period_end).toBeNull();
    expect(dbCheck.onlyInvoice(subscription.id)).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
    dbCheck.expectMatchesApi(subscription);
  });

  it('C2: a declined charge when the trial ends moves pro to past_due', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.trialingPro();
    provider.respondWith('decline');

    await steps.endTrial();

    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['failed']);
  });

  it('C3: a declined renewal moves active to past_due and keeps the earlier paid invoice', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    provider.respondWith('decline');

    await steps.advanceAndBill(BILLING_PERIOD_DAYS);

    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['paid', 'failed']);
  });

  it('a successful renewal keeps the subscription active and extends the period by 30 days', async () => {
    const { steps, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    const firstPeriodEnd = subscription.current_period_end as string;

    await steps.advanceAndBill(BILLING_PERIOD_DAYS);

    const renewed = await steps.current(subscription.id);
    expect(renewed.status).toBe('active');
    expect(renewed.current_period_end).toBe(daysAfter(firstPeriodEnd, BILLING_PERIOD_DAYS));
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['paid', 'paid']);
    expect(dbCheck.transitions(subscription.id)).toHaveLength(1);
    expect(dbCheck.events(subscription.id)).toEqual(['renewal_succeeded']);
  });

  it('C4: a provider timeout leaves the invoice pending, and the payment.succeeded webhook settles it', async () => {
    const { steps, provider, webhooks, dbCheck, providerCheck } = ctx();
    const subscription = await steps.trialingPro();
    provider.respondWith('timeout');

    await steps.endTrial();

    const invoice = dbCheck.pendingInvoice(subscription.id);
    expect(await steps.statusOf(subscription.id)).toBe('trialing');
    providerCheck.expectChargeCount(1);

    // While the result is unknown, later billing runs must not charge again.
    expect(await steps.advanceAndBill(1)).toBe(0);
    providerCheck.expectChargeCount(1);

    const response = await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(response.data().outcome).toBe('processed');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.invoice(invoice.id).status).toBe('paid');
    providerCheck.expectChargeCount(1);
  });

  it('C4: after a timeout, a payment.failed webhook moves the subscription to past_due', async () => {
    const { steps, provider, webhooks, dbCheck } = ctx();
    const subscription = await steps.trialingPro();
    provider.respondWith('timeout');
    await steps.endTrial();
    const invoice = dbCheck.pendingInvoice(subscription.id);

    const response = await webhooks.deliver(aPaymentWebhook().paymentFailed('insufficient_funds').forInvoice(invoice).build());

    expect(response.data().outcome).toBe('processed');
    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.invoice(invoice.id)).toMatchObject({ status: 'failed', failureReason: 'insufficient_funds' });
  });

  it('C5: a refund marks the invoice refunded and does not change the status', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    const invoice = dbCheck.onlyInvoice(subscription.id);

    const response = await webhooks.deliver(aPaymentWebhook().paymentRefunded().forInvoice(invoice).build());

    expect(response.data().outcome).toBe('processed');
    expect(dbCheck.invoice(invoice.id).status).toBe('refunded');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.events(subscription.id)).toEqual(['payment_refunded']);
  });

  it('a refund for an invoice that was never paid is ignored', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const before = dbCheck.snapshot(subscription.id);

    const response = await webhooks.deliver(aPaymentWebhook().paymentRefunded().forInvoice(invoice).build());

    expect(response.data().outcome).toBe('ignored_stale');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });

  it(`E6: the ${MAX_FAILED_ATTEMPTS}rd failed attempt in a row cancels the subscription`, async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic();
    provider.respondWith('decline', 'decline');

    await steps.advanceAndBill(1);
    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.events(subscription.id)).toEqual(['retry_failed']);

    await steps.advanceAndBill(1);

    expect(await steps.statusOf(subscription.id)).toBe('canceled');
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['failed', 'failed', 'failed']);
  });

  it('a successful payment resets the failure count', async () => {
    const { steps, provider, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic(); // failure 1
    provider.respondWith('succeed');
    await steps.advanceAndBill(1); // back to active
    provider.respondWith('decline', 'decline');

    await steps.advanceAndBill(BILLING_PERIOD_DAYS); // new failure 1
    await steps.advanceAndBill(1); // new failure 2

    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['failed', 'paid', 'failed', 'failed']);
  });
});
