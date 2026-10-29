import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * Events arrive in a different order than they happened. The rule that makes this safe: an invoice
 * that already has a result (paid / failed / refunded) is never overwritten by a later event.
 * Different event ids are used throughout, so none of these is a duplicate delivery.
 */
describe('POST /webhooks/payment-provider - out-of-order delivery', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('payment.failed after payment.succeeded for the same invoice (I3)', () => {
    it('does not regress the active subscription and does not overwrite the paid invoice', async () => {
      await env.seedBilling('trialing', ['pending']);
      await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_1').build());

      const late = await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_2').build());

      BillingAssertions.expectWebhookAck(late, 'ignored');
      expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
      await env.persistence.expectWebhookEvent('evt_2', { outcome: 'ignored', reason: 'invoice_already_paid' });
      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_1' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
    });

    it('also holds for a subscription activated by the API (basic plan charged at creation)', async () => {
      const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());
      expect(created.body.status).toBe('active');

      const late = await env.webhooks.deliver(
        aWebhookEvent().failed().withId('evt_late').forSubscription('sub_001').forInvoice('inv_001').withAmount(1900).build(),
      );

      BillingAssertions.expectWebhookAck(late, 'ignored');
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      ]);
      env.providerCalls.expectCallCount(1); // only the creation charge
    });
  });

  describe('payment.succeeded after payment.failed for the same invoice', () => {
    // The assignment is silent here. Documented choice: a failed invoice is terminal, so the late
    // success is ignored and recorded. A real system would need reconciliation (see TEST_STRATEGY.md).
    it('is ignored: the subscription stays past_due and the invoice stays failed', async () => {
      await env.seedBilling('trialing', ['pending']);
      await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_1').build());

      const late = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_2').build());

      BillingAssertions.expectWebhookAck(late, 'ignored');
      await env.persistence.expectStoredStatus('sub_seed_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed']);
      await env.persistence.expectWebhookEvent('evt_2', { outcome: 'ignored', reason: 'invoice_already_failed' });
      await env.persistence.expectCoherent('sub_seed_001');
    });
  });

  describe('payment.refunded before payment.succeeded', () => {
    // Documented limitation: the early refund is recorded as ignored and not replayed later.
    it('the refund is ignored while the invoice is pending; the later success still activates', async () => {
      await env.seedBilling('trialing', ['pending']);

      const early = await env.webhooks.deliver(aWebhookEvent().refunded().withId('evt_refund').build());
      const success = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_paid').build());

      BillingAssertions.expectWebhookAck(early, 'ignored');
      BillingAssertions.expectWebhookAck(success, 'processed');
      await env.persistence.expectWebhookEvent('evt_refund', { outcome: 'ignored', reason: 'invoice_not_paid' });
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
    });
  });

  describe('a stale event for an older attempt arrives after a newer attempt succeeded', () => {
    it('the stale failure for the already failed attempt cannot push the active subscription back', async () => {
      await env.seedBilling('past_due', ['failed', 'pending']);
      await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_retry_ok').forInvoice('inv_seed_002').build());

      const stale = await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_stale').forInvoice('inv_seed_001').build());

      BillingAssertions.expectWebhookAck(stale, 'ignored');
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed', 'paid']);
      await env.persistence.expectWebhookEvent('evt_stale', { outcome: 'ignored', reason: 'invoice_already_failed' });
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
    });

    it('a stale success for the older paid attempt does not create a second payment', async () => {
      await env.seedBilling('active', ['paid', 'paid']);

      const stale = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_stale').forInvoice('inv_seed_001').build());

      BillingAssertions.expectWebhookAck(stale, 'ignored');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid', 'paid']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
    });
  });
});
