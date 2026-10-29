import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import { anInvoiceRecord } from '../../framework/builders/InvoiceRecordBuilder';

/** `payment.succeeded` against subscriptions seeded in each state. Webhook delivery is the behavior under test. */
describe('POST /webhooks/payment-provider - payment.succeeded', () => {
  let env: TestEnvironment;
  const succeeded = () => aWebhookEvent().succeeded().withId('evt_ok');

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('trialing -> active (V1)', () => {
    beforeEach(async () => {
      await env.seedBilling('trialing', ['pending']);
    });

    it('activates the subscription and says so in the API', async () => {
      const res = await env.webhooks.deliver(succeeded().build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('active');
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
    });

    it('marks the invoice paid (the only invoice, not a new one)', async () => {
      await env.webhooks.deliver(succeeded().build());

      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
      await env.persistence.expectInvoice('inv_seed_001', { amount: 4900, currency: 'USD', attempt: 1 });
    });

    it('records the transition in the audit log, attributed to the webhook event', async () => {
      await env.webhooks.deliver(succeeded().build());

      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_ok' },
      ]);
    });

    it('records the webhook event as processed, delivered once', async () => {
      await env.webhooks.deliver(succeeded().build());

      await env.persistence.expectWebhookEventCount(1);
      await env.persistence.expectWebhookEvent('evt_ok', {
        type: 'payment.succeeded',
        subscriptionId: 'sub_seed_001',
        invoiceId: 'inv_seed_001',
        outcome: 'processed',
        deliveryCount: 1,
      });
    });

    it('is coherent across subscription, invoice, event and audit, and never calls the provider', async () => {
      const res = await env.webhooks.deliver(succeeded().build());
      expect(res.status).toBe(200);

      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
      env.providerCalls.expectNoCharges();
    });
  });

  describe('past_due -> active on a successful retry (V4)', () => {
    beforeEach(async () => {
      await env.seedBilling('past_due', ['failed', 'pending']);
    });

    it('activates the subscription and pays the retry invoice, keeping the failed attempt on record', async () => {
      const res = await env.webhooks.deliver(succeeded().forInvoice('inv_seed_002').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed', 'paid']);
      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_ok' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001', (await env.api.getSubscription('sub_seed_001')).body);
    });
  });

  describe('active, recurring invoice paid', () => {
    beforeEach(async () => {
      await env.seedBilling('active', ['paid', 'pending']);
    });

    it('pays the invoice and keeps the subscription active without a transition', async () => {
      const res = await env.webhooks.deliver(succeeded().forInvoice('inv_seed_002').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid', 'paid']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
      await env.persistence.expectWebhookEvent('evt_ok', { outcome: 'processed' });
    });
  });

  describe('events that must not change anything but the event log', () => {
    beforeEach(async () => {
      await env.seedBilling('trialing', ['pending']);
    });

    const expectIgnored = async (reason: string) => {
      await env.persistence.expectWebhookEvent('evt_ok', { outcome: 'ignored', reason, deliveryCount: 1 });
      await env.persistence.expectStoredStatus('sub_seed_001', 'trialing');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['pending']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
      env.providerCalls.expectNoCharges();
    };

    it('unknown invoice: acknowledged as ignored and recorded', async () => {
      const res = await env.webhooks.deliver(succeeded().forInvoice('inv_nope').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await expectIgnored('invoice_not_found');
    });

    it('invoice that belongs to another subscription: ignored, and that invoice is left alone', async () => {
      await env.seedSubscription({ ...(await env.subscriptions.findById('sub_seed_001'))!, id: 'sub_other' });
      await env.seedInvoice(anInvoiceRecord().withId('inv_other').forSubscription('sub_other').build());

      const res = await env.webhooks.deliver(succeeded().forInvoice('inv_other').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await expectIgnored('invoice_not_found');
      await env.persistence.expectInvoiceStatuses('sub_other', ['pending']);
    });

    it('amount differs from the invoice: ignored, invoice stays pending', async () => {
      const res = await env.webhooks.deliver(succeeded().withAmount(1).build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await expectIgnored('amount_mismatch');
    });

    it('currency differs from the invoice: ignored, invoice stays pending', async () => {
      const res = await env.webhooks.deliver(succeeded().withCurrency('EUR').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await expectIgnored('amount_mismatch');
    });
  });

  describe('invoice that already has a result (I5)', () => {
    it('a new event for an already paid invoice is ignored: no state change, no second invoice', async () => {
      await env.seedBilling('active', ['paid']);

      const res = await env.webhooks.deliver(succeeded().build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_ok', { outcome: 'ignored', reason: 'invoice_already_paid' });
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
      await env.persistence.expectNoAuditEntries('sub_seed_001');
    });
  });
});
