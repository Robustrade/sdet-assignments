import { describe, expect, it } from 'vitest';
import { aSubscriptionRequest } from '../support/builders/subscriptionRequestBuilder';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';

describe('G2. partial failures roll back completely', () => {
  const ctx = useTestContext({ injectAuditFaults: true });

  it('a webhook that fails halfway leaves no trace, and the redelivery is applied once', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const before = dbCheck.snapshot(subscription.id);
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();
    ctx().faults().failOnNthWrite(1); // the audit write for the activation

    const failed = await webhooks.deliver(event);

    expect(failed.status).toBe(500);
    expect(dbCheck.snapshot(subscription.id)).toEqual(before); // invoice still pending, still trialing
    expect(dbCheck.webhookEvent(event.event_id)).toBeUndefined(); // not marked as processed

    const redelivered = await webhooks.deliver(event);

    expect(redelivered.data().outcome).toBe('processed');
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.transitions(subscription.id)).toHaveLength(1);
    expect(dbCheck.webhookEvents()).toHaveLength(1);
  });

  it('if saving fails after the provider charged, the invoice stays pending and the webhook settles it', async () => {
    const { api, webhooks, dbCheck, providerCheck, steps } = ctx();
    ctx().faults().failOnNthWrite(2); // 1st write = 'created' entry, 2nd = the activation

    const response = await api.createSubscription(aSubscriptionRequest().onPlan('basic').build());

    expect(response.status).toBe(500);
    const [subscription] = dbCheck.allSubscriptions();
    expect(subscription?.status).toBe('trialing');
    const invoice = dbCheck.onlyInvoice(subscription?.id ?? '');
    expect(invoice.status).toBe('pending');
    providerCheck.expectChargeCount(1);

    const settled = await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build());

    expect(settled.data().outcome).toBe('processed');
    expect(await steps.statusOf(invoice.subscriptionId)).toBe('active');
    providerCheck.expectChargeCount(1);
  });
});
