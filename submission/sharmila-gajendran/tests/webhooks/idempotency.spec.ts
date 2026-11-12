import { describe, expect, it } from 'vitest';
import { aPaymentWebhook } from '../support/builders/webhookEventBuilder';
import { useTestContext } from '../support/testContext';

describe('D. duplicate webhooks (idempotency)', () => {
  const ctx = useTestContext();

  it('D1: the same payment.succeeded delivered twice is applied once', async () => {
    const { steps, webhooks, dbCheck, providerCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();

    const first = await webhooks.deliver(event);
    const second = await webhooks.deliver(event);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect([first.data().outcome, second.data().outcome]).toEqual(['processed', 'duplicate']);
    expect(await steps.statusOf(subscription.id)).toBe('active');
    expect(dbCheck.transitions(subscription.id)).toEqual([
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook' },
    ]);
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['paid']);
    expect(dbCheck.webhookEvents().map((stored) => stored.eventId)).toEqual([event.event_id]);
    // D4: only the original billing attempt reached the provider.
    providerCheck.expectChargeCount(1);
  });

  it('D2: the same payment.failed delivered twice counts as one failure', async () => {
    const { steps, provider, webhooks, dbCheck } = ctx();
    const subscription = await steps.pastDueBasic(); // failure 1
    provider.respondWith('pending');
    await steps.advanceAndBill(1);
    const retry = dbCheck.pendingInvoice(subscription.id);
    const event = aPaymentWebhook().paymentFailed().forInvoice(retry).build();

    const first = await webhooks.deliver(event);
    const second = await webhooks.deliver(event);

    expect([first.data().outcome, second.data().outcome]).toEqual(['processed', 'duplicate']);
    // Counted twice, this would be 3 failures and the subscription would be canceled too early.
    expect(await steps.statusOf(subscription.id)).toBe('past_due');
    expect(dbCheck.invoiceStatuses(subscription.id)).toEqual(['failed', 'failed']);
    expect(dbCheck.events(subscription.id)).toEqual(['retry_failed']);
  });

  it('D3: the same result for the same invoice under a new event id is ignored', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const original = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();
    const resent = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();

    const first = await webhooks.deliver(original);
    const second = await webhooks.deliver(resent);

    expect([first.data().outcome, second.data().outcome]).toEqual(['processed', 'ignored_stale']);
    expect(dbCheck.transitions(subscription.id)).toHaveLength(1);
    expect(dbCheck.webhookEvents().map((stored) => [stored.eventId, stored.outcome])).toEqual([
      [original.event_id, 'processed'],
      [resent.event_id, 'ignored_stale'],
    ]);
  });

  it('a replayed event is still a duplicate after the subscription has moved on', async () => {
    const { steps, api, webhooks } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();
    await webhooks.deliver(event);
    await api.cancelSubscription(subscription.id);

    const replay = await webhooks.deliver(event);

    expect(replay.data().outcome).toBe('duplicate');
    expect(await steps.statusOf(subscription.id)).toBe('canceled');
  });

  it('two identical deliveries sent at the same moment are applied once', async () => {
    const { steps, webhooks, dbCheck } = ctx();
    const { subscription, invoice } = await steps.proWithPendingInvoice();
    const event = aPaymentWebhook().paymentSucceeded().forInvoice(invoice).build();

    const responses = await Promise.all([webhooks.deliver(event), webhooks.deliver(event)]);

    expect(responses.map((response) => response.data().outcome).sort()).toEqual(['duplicate', 'processed']);
    expect(dbCheck.transitions(subscription.id)).toHaveLength(1);
  });

  it('D4: webhooks never call the payment provider', async () => {
    const { steps, webhooks, dbCheck, providerCheck } = ctx();
    const subscription = await steps.activeBasic();
    const invoice = dbCheck.onlyInvoice(subscription.id);
    const refund = aPaymentWebhook().paymentRefunded().forInvoice(invoice).build();

    await webhooks.deliver(refund);
    await webhooks.deliver(refund);
    await webhooks.deliver(aPaymentWebhook().paymentFailed().forInvoice(invoice).build());
    await webhooks.deliver(aPaymentWebhook().paymentSucceeded().forSubscription(subscription.id).build());

    providerCheck.expectChargeCount(1);
  });
});
