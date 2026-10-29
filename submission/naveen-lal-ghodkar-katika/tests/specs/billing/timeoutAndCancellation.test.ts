import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * Two gaps found in the Phase 5 review (see TEST_STRATEGY.md, section 14):
 *
 * 1. A charge that timed out and is settled by a later run must record WHEN it was settled. The retry
 *    interval is counted from that time; a stale `updatedAt` would make the next retry come early.
 * 2. A subscription canceled while a timed-out invoice is still `pending` keeps that invoice as it is.
 *    The assignment requires that cancellation stops future billing and that no later webhook revives
 *    the subscription; it does not require voiding the invoice (and a timeout means the provider may
 *    really have captured the money, so silently voiding would hide that). These specs pin down the
 *    behavior so it cannot change by accident.
 */
describe('billing run: timed-out charges', () => {
  let env: TestEnvironment;

  const webhook = (type: 'succeeded' | 'failed' | 'refunded', eventId: string, invoiceId: string, amount: number) =>
    aWebhookEvent().with('type', `payment.${type}`).withId(eventId).forSubscription('sub_001').forInvoice(invoiceId).withAmount(amount).build();

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('resent invoice settled later by a billing run', () => {
    beforeEach(async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build()); // sub_001, trial ends 2026-01-15
      env.clock.advanceDays(14);
      env.provider.timeoutOnce();
      await env.runBilling(); // inv_001 pending since 2026-01-15
      env.clock.advanceDays(2); // 2026-01-17: the resend is answered
    });

    it('stamps the invoice with the time of the answer, keeping its creation time', async () => {
      env.provider.declineOnce('do_not_honor');

      await env.runBilling();

      await env.persistence.expectInvoice('inv_001', {
        status: 'failed',
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-17T00:00:00.000Z',
      });
    });

    it('counts the next retry from the answer, not from when the invoice was first created', async () => {
      env.provider.declineOnce('do_not_honor');
      await env.runBilling(); // failed on day 16 -> past_due

      env.clock.advanceDays(1);
      env.clock.advanceMs(-1);
      expect(await env.runBilling()).toEqual([]); // one millisecond short of a day after the failure
      env.providerCalls.expectCallCount(2); // the timeout and its resend

      env.clock.advanceMs(1);
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' },
      ]);
      await env.persistence.expectStoredStatus('sub_001', 'active');
    });
  });

  describe('subscription canceled while a timed-out invoice is pending', () => {
    it('trial-end charge: stays pending, nothing more is charged, a late success cannot revive it', async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
      env.clock.advanceDays(14);
      env.provider.timeoutOnce();
      await env.runBilling(); // inv_001 pending, subscription still trialing

      const canceled = await env.api.cancelSubscription('sub_001');
      expect(canceled.status).toBe(200);
      expect(canceled.body.status).toBe('canceled');

      env.clock.advanceDays(60);
      expect(await env.runBilling()).toEqual([]);
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_late', 'inv_001', 4900)), 'ignored');
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('failed', 'evt_late_f', 'inv_001', 4900)), 'ignored');

      env.providerCalls.expectCallCount(1); // only the attempt made before the cancel
      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', ['pending']); // known limitation: not voided
      await env.persistence.expectInvoiceWithoutProviderCharge('inv_001');
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
      await env.persistence.expectWebhookEvent('evt_late', { outcome: 'ignored', reason: 'subscription_canceled' });
      await env.persistence.expectWebhookEvent('evt_late_f', { outcome: 'ignored', reason: 'subscription_canceled' });
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });

    it('recurring charge: the earlier paid invoice is untouched, the pending one stays, nothing is revived', async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build()); // active, inv_001 paid
      env.clock.advanceDays(30);
      env.provider.timeoutOnce();
      await env.runBilling(); // inv_002 pending, subscription still active

      await env.api.cancelSubscription('sub_001');
      env.clock.advanceDays(60);
      expect(await env.runBilling()).toEqual([]);
      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(webhook('succeeded', 'evt_late', 'inv_002', 1900)), 'ignored');

      env.providerCalls.expectCallCount(2); // creation charge plus the timed-out recurring attempt
      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'pending']);
      await env.persistence.expectAuditPath('sub_001', ['trialing', 'active', 'canceled']);
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });

    it('a second cancel is rejected with 409 and adds nothing, even with a pending invoice', async () => {
      await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
      env.clock.advanceDays(14);
      env.provider.timeoutOnce();
      await env.runBilling();
      await env.api.cancelSubscription('sub_001');
      const before = await env.persistence.snapshot();

      const again = await env.api.cancelSubscription('sub_001');

      expect(again.status).toBe(409);
      await env.persistence.expectUnchangedSince(before);
    });
  });
});
