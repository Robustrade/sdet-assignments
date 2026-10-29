import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/** `payment.failed` against subscriptions seeded in each state. */
describe('POST /webhooks/payment-provider - payment.failed', () => {
  let env: TestEnvironment;
  const failed = () => aWebhookEvent().failed().withId('evt_fail');

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('trialing -> past_due (V2)', () => {
    beforeEach(async () => {
      await env.seedBilling('trialing', ['pending']);
    });

    it('moves to past_due (not active, not canceled), visibly in the API', async () => {
      const res = await env.webhooks.deliver(failed().build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('past_due');
      await env.persistence.expectStoredStatus('sub_seed_001', 'past_due');
    });

    it('records the failure on the invoice and creates no paid record', async () => {
      await env.webhooks.deliver(failed().build());

      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed']);
    });

    it('records the transition and the event, and stays coherent', async () => {
      await env.webhooks.deliver(failed().build());

      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'webhook', eventId: 'evt_fail' },
      ]);
      await env.persistence.expectWebhookEvent('evt_fail', { type: 'payment.failed', outcome: 'processed', deliveryCount: 1 });
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
      env.providerCalls.expectNoCharges();
    });
  });

  describe('active -> past_due on a failed recurring charge (V3)', () => {
    it('moves to past_due, fails only the new invoice and keeps the earlier paid one', async () => {
      await env.seedBilling('active', ['paid', 'pending']);

      const res = await env.webhooks.deliver(failed().forInvoice('inv_seed_002').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      await env.persistence.expectStoredStatus('sub_seed_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid', 'failed']);
      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'active', to: 'past_due', trigger: 'charge_failed', source: 'webhook', eventId: 'evt_fail' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
    });
  });

  describe('past_due retries', () => {
    it('a second failed attempt keeps the subscription past_due and adds no audit entry', async () => {
      await env.seedBilling('past_due', ['failed', 'pending']);

      const res = await env.webhooks.deliver(failed().forInvoice('inv_seed_002').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      await env.persistence.expectStoredStatus('sub_seed_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed', 'failed']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
      await env.persistence.expectWebhookEvent('evt_fail', { outcome: 'processed' });
    });

    it('the third consecutive failure exhausts the retries: past_due -> canceled (V5)', async () => {
      await env.seedBilling('past_due', ['failed', 'failed', 'pending']);

      const res = await env.webhooks.deliver(failed().forInvoice('inv_seed_003').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('canceled');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed', 'failed', 'failed']);
      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'past_due', to: 'canceled', trigger: 'retries_exhausted', source: 'webhook', eventId: 'evt_fail' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
    });

    it('failures separated by a payment do not count as consecutive', async () => {
      // failed, paid (retry worked), then two more failures: only the trailing run of failures counts.
      await env.seedBilling('past_due', ['failed', 'failed', 'paid', 'failed', 'pending']);

      await env.webhooks.deliver(failed().forInvoice('inv_seed_005').build());

      await env.persistence.expectStoredStatus('sub_seed_001', 'past_due');
    });
  });

  describe('events that must not change anything but the event log', () => {
    it('unknown invoice: ignored and recorded, subscription untouched', async () => {
      await env.seedBilling('active', ['paid']);

      const res = await env.webhooks.deliver(failed().forInvoice('inv_nope').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_fail', { outcome: 'ignored', reason: 'invoice_not_found' });
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
    });

    it('amount differs from the invoice: ignored, invoice stays pending', async () => {
      await env.seedBilling('trialing', ['pending']);

      const res = await env.webhooks.deliver(failed().withAmount(100).build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_fail', { outcome: 'ignored', reason: 'amount_mismatch' });
      await env.persistence.expectStoredStatus('sub_seed_001', 'trialing');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['pending']);
    });
  });
});
