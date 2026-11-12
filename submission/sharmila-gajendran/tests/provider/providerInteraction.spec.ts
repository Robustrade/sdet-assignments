import { describe, expect, it } from 'vitest';
import { aSubscriptionRequest } from '../support/builders/subscriptionRequestBuilder';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';
import { CUSTOMER_1, CUSTOMER_2, EXPECTED_PLANS } from '../support/testData';

describe('F. payment provider interaction', () => {
  const ctx = useTestContext();

  it('F1: charges the pro price to the right customer exactly once when the trial ends', async () => {
    const { steps, dbCheck, providerCheck } = ctx();
    const subscription = await steps.trialingPro(CUSTOMER_2);
    providerCheck.expectNoCharges();

    await steps.endTrial();

    const invoice = dbCheck.onlyInvoice(subscription.id);
    providerCheck.expectOnlyCharge({
      amountCents: EXPECTED_PLANS.pro.priceCents,
      currency: EXPECTED_PLANS.pro.currency,
      customerId: CUSTOMER_2.id,
      paymentMethodId: CUSTOMER_2.paymentMethodId,
      idempotencyKey: invoice.id,
      reference: subscription.id,
    });
  });

  it('F1: makes one call per billing attempt, each with its own idempotency key', async () => {
    const { steps, provider, dbCheck, providerCheck } = ctx();
    const subscription = await steps.pastDueBasic();
    provider.respondWith('decline', 'succeed');

    await steps.advanceAndBill(1);
    await steps.advanceAndBill(1);

    const invoices = dbCheck.invoices(subscription.id);
    expect(invoices.map((invoice) => invoice.status)).toEqual(['failed', 'failed', 'paid']);
    expect(providerCheck.calls.map((call) => call.idempotencyKey)).toEqual(invoices.map((invoice) => invoice.id));
    expect(new Set(providerCheck.calls.map((call) => call.idempotencyKey)).size).toBe(3);
    for (const call of providerCheck.calls) {
      expect(call).toMatchObject({
        amountCents: EXPECTED_PLANS.basic.priceCents,
        customerId: CUSTOMER_1.id,
        paymentMethodId: CUSTOMER_1.paymentMethodId,
        reference: subscription.id,
      });
    }
  });

  it('F2: never calls the provider for rejected creates, reads, cancels or webhooks', async () => {
    const { steps, api, webhooks, providerCheck } = ctx();
    const subscription = await steps.trialingPro();

    await api.createSubscription(aSubscriptionRequest().onPlan('enterprise').build());
    await api.createSubscription(aSubscriptionRequest().onPlan('basic').withCustomerId('cust_999').build());
    await api.createSubscription(aSubscriptionRequest().onPlan('basic').withPaymentMethod(CUSTOMER_2.paymentMethodId).build());
    await api.getSubscription(subscription.id);
    await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forSubscription(subscription.id).build());
    await api.cancelSubscription(subscription.id);
    await api.cancelSubscription(subscription.id);

    providerCheck.expectNoCharges();
  });

  it('F3: a timed-out attempt is never charged again, and the next attempt gets a new key', async () => {
    const { steps, provider, webhooks, dbCheck, providerCheck } = ctx();
    const subscription = await steps.trialingPro();
    provider.respondWith('timeout');
    await steps.endTrial();
    const timedOut = dbCheck.pendingInvoice(subscription.id);

    await steps.advanceAndBill(1);
    await steps.advanceAndBill(1);
    providerCheck.expectChargeCount(1);

    await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(timedOut).build());
    await steps.advanceAndBill(1);

    providerCheck.expectChargeCount(2);
    const retry = dbCheck.latestInvoice(subscription.id);
    expect(retry.id).not.toBe(timedOut.id);
    expect(providerCheck.calls[1]?.idempotencyKey).toBe(retry.id);
    expect(await steps.statusOf(subscription.id)).toBe('active');
  });

  it('does not charge anyone before their trial ends', async () => {
    const { steps, providerCheck } = ctx();
    await steps.trialingPro();

    const attempted = await steps.advanceAndBill(EXPECTED_PLANS.pro.trialDays - 1);

    expect(attempted).toBe(0);
    providerCheck.expectNoCharges();
  });
});
