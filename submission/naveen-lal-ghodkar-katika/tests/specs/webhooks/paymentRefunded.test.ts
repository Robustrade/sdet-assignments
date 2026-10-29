import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * `payment.refunded` is bookkeeping: it marks a paid invoice refunded and never changes the
 * subscription status (the lifecycle has no refund transition).
 */
describe('POST /webhooks/payment-provider - payment.refunded', () => {
  let env: TestEnvironment;
  const refunded = () => aWebhookEvent().refunded().withId('evt_refund');

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  it('marks the paid invoice refunded and leaves the subscription active', async () => {
    await env.seedBilling('active', ['paid']);

    const res = await env.webhooks.deliver(refunded().build());

    BillingAssertions.expectWebhookAck(res, 'processed');
    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['refunded']);
    expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('active');
    await env.persistence.expectStoredStatus('sub_seed_001', 'active');
  });

  it('records the event and adds no audit entry (no state transition happened)', async () => {
    await env.seedBilling('active', ['paid']);

    await env.webhooks.deliver(refunded().build());

    await env.persistence.expectWebhookEvent('evt_refund', {
      type: 'payment.refunded',
      outcome: 'processed',
      deliveryCount: 1,
    });
    await env.persistence.expectNoAuditEntries('sub_seed_001');
    await env.persistence.expectCoherent('sub_seed_001');
    env.providerCalls.expectNoCharges();
  });

  it('only touches the refunded invoice, not the other invoices of the subscription', async () => {
    await env.seedBilling('active', ['paid', 'paid']);

    await env.webhooks.deliver(refunded().forInvoice('inv_seed_001').build());

    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['refunded', 'paid']);
  });

  describe('invoices that cannot be refunded are left as they are', () => {
    it.each([
      ['pending', 'invoice_not_paid'],
      ['failed', 'invoice_not_paid'],
      ['refunded', 'invoice_already_refunded'],
    ] as const)('%s invoice: ignored (%s)', async (invoiceStatus, reason) => {
      await env.seedBilling('active', ['paid', invoiceStatus]);

      const res = await env.webhooks.deliver(refunded().forInvoice('inv_seed_002').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_refund', { outcome: 'ignored', reason });
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid', invoiceStatus]);
      await env.persistence.expectStoredStatus('sub_seed_001', 'active');
    });

    it('unknown invoice: ignored', async () => {
      await env.seedBilling('active', ['paid']);

      const res = await env.webhooks.deliver(refunded().forInvoice('inv_nope').build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_refund', { outcome: 'ignored', reason: 'invoice_not_found' });
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
    });

    it('amount differs from the invoice (partial refunds are not modeled): ignored', async () => {
      await env.seedBilling('active', ['paid']);

      const res = await env.webhooks.deliver(refunded().withAmount(1000).build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectWebhookEvent('evt_refund', { outcome: 'ignored', reason: 'amount_mismatch' });
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
    });
  });
});
