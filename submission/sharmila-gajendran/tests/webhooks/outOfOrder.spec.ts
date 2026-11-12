import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { BILLING_PERIOD_DAYS } from '../support/testData';

describe('out-of-order and late webhooks', () => {
  const ctx = useTestContext();

  it('E4: payment.failed after payment.succeeded for the same invoice does not undo the activation', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());
    const before = dbCheck.snapshot(subscription.id);

    const late = await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(invoice).build());

    expect(late.data().outcome).toBe('ignored_stale');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });

  it('payment.succeeded after payment.failed for the same invoice does not reactivate it (first result wins)', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(invoice).build());
    const before = dbCheck.snapshot(subscription.id);

    const late = await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(late.data().outcome).toBe('ignored_stale');
    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });

  it('a late payment.failed for an old, already paid invoice is ignored after a renewal', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const subscription = await steps.activeBasic();
    const firstInvoice = dbCheck.onlyInvoice(subscription.id);
    await steps.advanceAndBill(BILLING_PERIOD_DAYS);
    const before = dbCheck.snapshot(subscription.id);

    const late = await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(firstInvoice).build());

    expect(late.data().outcome).toBe('ignored_stale');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.snapshot(subscription.id)).toEqual(before);
  });
});
