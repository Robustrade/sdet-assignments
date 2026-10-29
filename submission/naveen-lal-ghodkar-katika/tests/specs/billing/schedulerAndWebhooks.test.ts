import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * The billing run and the provider's webhooks both settle invoices. These specs prove they do not
 * fight over the same invoice: whichever answers first wins, the other is recorded as ignored or
 * duplicate, and nothing is charged or counted twice.
 */
describe('billing run together with webhooks', () => {
  let env: TestEnvironment;

  const proTrialEnded = async () => {
    await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build()); // sub_001
    env.clock.advanceDays(14);
  };
  const basicWithDeclinedStart = async () => {
    env.provider.declineOnce('insufficient_funds');
    await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build()); // sub_001, inv_001 failed
  };
  const webhook = (type: 'succeeded' | 'failed' | 'refunded', eventId: string, invoiceId: string, amount: number) =>
    aWebhookEvent().with('type', `payment.${type}`).withId(eventId).forSubscription('sub_001').forInvoice(invoiceId).withAmount(amount).build();

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('provider timeout resolved by a webhook', () => {
    beforeEach(async () => {
      await proTrialEnded();
      env.provider.timeoutOnce();
      await env.runBilling(); // inv_001 stays pending
    });

    it('payment.succeeded settles the pending invoice; a redelivery and a later run change nothing', async () => {
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_1', 'inv_001', 4900)), 'processed');
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_1', 'inv_001', 4900)), 'duplicate');
      expect(await env.runBilling()).toEqual([]);

      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_1' },
      ]);
      await env.persistence.expectWebhookEvent('evt_1', { outcome: 'processed', deliveryCount: 2 });
      await env.persistence.expectCoherent('sub_001', res.body);
      env.providerCalls.expectCallCount(1); // the timed-out attempt only: webhook and run did not charge again
    });

    it('payment.failed settles it as failed (past_due); the next retry is a new attempt one day later', async () => {
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('failed', 'evt_f', 'inv_001', 4900)), 'processed');
      await env.persistence.expectStoredStatus('sub_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);

      expect(await env.runBilling()).toEqual([]); // the retry interval counts from the webhook's time
      env.providerCalls.expectCallCount(1);

      env.clock.advanceDays(1);
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' },
      ]);
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'paid']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'webhook', eventId: 'evt_f' },
        { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
    });

    it('the retry interval counts from when the failure was recorded, not from when the invoice was created', async () => {
      env.clock.advanceDays(2);
      await env.webhooks.deliver(webhook('failed', 'evt_f', 'inv_001', 4900)); // failure recorded on day 16

      env.clock.advanceDays(1);
      env.clock.advanceMs(-1);
      expect(await env.runBilling()).toEqual([]); // one millisecond short of day 17
      env.providerCalls.expectCallCount(1);

      env.clock.advanceMs(1);
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' },
      ]);
    });

    it('canceling first makes the late payment.succeeded webhook a recorded no-op', async () => {
      await env.api.cancelSubscription('sub_001');

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_late', 'inv_001', 4900)), 'ignored');
      expect(await env.runBilling()).toEqual([]);

      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectWebhookEvent('evt_late', { outcome: 'ignored', reason: 'subscription_canceled' });
      env.providerCalls.expectCallCount(1);
    });
  });

  describe('out-of-order and stray webhooks for scheduler-created invoices', () => {
    it('a payment.failed webhook arriving after the run already got a success does not regress the subscription', async () => {
      await proTrialEnded();
      await env.runBilling(); // inv_001 paid, active

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('failed', 'evt_stale', 'inv_001', 4900)), 'ignored');

      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectWebhookEvent('evt_stale', { outcome: 'ignored', reason: 'invoice_already_paid' });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
    });

    it('a payment.succeeded echo for an invoice the run already paid creates no second invoice or charge', async () => {
      await proTrialEnded();
      await env.runBilling();

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_echo', 'inv_001', 4900)), 'ignored');

      await env.persistence.expectInvoiceCount('sub_001', 1);
      env.providerCalls.expectCallCount(1);
    });

    it('a payment.failed webhook for an invoice the run already failed is not counted as a second failure', async () => {
      env.provider.willDecline('card_declined');
      await proTrialEnded();
      await env.runBilling(); // inv_001 failed, past_due

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('failed', 'evt_echo', 'inv_001', 4900)), 'ignored');

      await env.persistence.expectStoredStatus('sub_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
      await env.persistence.expectWebhookEvent('evt_echo', { outcome: 'ignored', reason: 'invoice_already_failed' });
    });

    it('a webhook that arrives before the run created its invoice is ignored and activates nothing', async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
      env.clock.advanceDays(5);

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_early', 'inv_001', 4900)), 'ignored');
      await env.persistence.expectStoredStatus('sub_001', 'trialing');
      await env.persistence.expectNoInvoices();
      await env.persistence.expectWebhookEvent('evt_early', { outcome: 'ignored', reason: 'invoice_not_found' });

      env.clock.advanceDays(9);
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'paid' },
      ]);
      await env.persistence.expectStoredStatus('sub_001', 'active');
    });

    it('a refund webhook marks the invoice refunded without stopping or delaying the next recurring charge', async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build()); // active, inv_001 paid
      env.clock.advanceDays(10);
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('refunded', 'evt_ref', 'inv_001', 1900)), 'processed');
      await env.persistence.expectInvoiceStatuses('sub_001', ['refunded']);
      await env.persistence.expectStoredStatus('sub_001', 'active');

      env.clock.advanceDays(20); // day 30 after the payment, 20 days after the refund
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' },
      ]);

      await env.persistence.expectInvoiceStatuses('sub_001', ['refunded', 'paid']);
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });
  });

  describe('retry counting is not fooled by redelivery', () => {
    it('the same payment.failed event delivered three times counts as one failed retry', async () => {
      await basicWithDeclinedStart(); // attempt 1 failed
      env.clock.advanceDays(1);
      env.provider.timeoutOnce();
      await env.runBilling(); // attempt 2 pending

      const failed = webhook('failed', 'evt_retry_failed', 'inv_002', 1900);
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(failed), 'processed');
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(failed), 'duplicate');
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(failed), 'duplicate');

      await env.persistence.expectStoredStatus('sub_001', 'past_due'); // 2 failures, not 4
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed']);
      await env.persistence.expectWebhookEvent('evt_retry_failed', { deliveryCount: 3 });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
      ]);
    });

    it('failures settled by webhooks and by the run add up to the same retry limit', async () => {
      await basicWithDeclinedStart(); // attempt 1 failed (api)
      env.clock.advanceDays(1);
      env.provider.timeoutOnce();
      await env.runBilling(); // attempt 2 pending
      await env.webhooks.deliver(webhook('failed', 'evt_a2', 'inv_002', 1900)); // attempt 2 failed (webhook)
      await env.persistence.expectStoredStatus('sub_001', 'past_due');

      env.clock.advanceDays(1);
      env.provider.willDecline('card_declined');
      await env.runBilling(); // attempt 3 failed (run) -> third in a row

      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed', 'failed']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
        { from: 'past_due', to: 'canceled', trigger: 'retries_exhausted', source: 'scheduler' },
      ]);
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });
  });
});
