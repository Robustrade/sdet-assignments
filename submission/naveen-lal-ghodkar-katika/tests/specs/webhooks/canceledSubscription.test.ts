import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import { anInvoiceRecord } from '../../framework/builders/InvoiceRecordBuilder';

/**
 * `canceled` is terminal. No webhook may reactivate (or otherwise move) a canceled subscription,
 * however it got there. A refund is the one exception to "ignored": it only updates an invoice.
 */
describe('POST /webhooks/payment-provider - canceled subscriptions (I1, I2)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe.each([
    ['trialing', ['pending']],
    ['active', ['paid', 'pending']],
  ] as const)('canceled through the API from %s', (status, invoices) => {
    const pendingInvoice = `inv_seed_00${invoices.length}`;

    beforeEach(async () => {
      await env.seedBilling(status, [...invoices]);
      const canceled = await env.api.cancelSubscription('sub_seed_001');
      expect(canceled.body.status).toBe('canceled');
    });

    it('payment.succeeded does not reactivate it', async () => {
      const res = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_late').forInvoice(pendingInvoice).build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      expect((await env.api.getSubscription('sub_seed_001')).body.status).toBe('canceled');
      await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', [...invoices]); // pending invoice left pending
      await env.persistence.expectWebhookEvent('evt_late', { outcome: 'ignored', reason: 'subscription_canceled' });
    });

    it('payment.failed does not move it either', async () => {
      const res = await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_late').forInvoice(pendingInvoice).build());

      BillingAssertions.expectWebhookAck(res, 'ignored');
      await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', [...invoices]);
    });

    it('adds no audit entry beyond the cancel itself and never calls the provider', async () => {
      await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_late').forInvoice(pendingInvoice).build());
      await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_late_2').forInvoice(pendingInvoice).build());

      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: status, to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001');
      env.providerCalls.expectNoCharges();
    });
  });

  it('a canceled subscription created through the API stays canceled after a late success (end to end)', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    const id = created.body.id;
    await env.seedInvoice(anInvoiceRecord().withId('inv_pro_001').forSubscription(id).pending().build());
    await env.api.cancelSubscription(id);

    const res = await env.webhooks.deliver(
      aWebhookEvent().succeeded().withId('evt_late').forSubscription(id).forInvoice('inv_pro_001').build(),
    );

    BillingAssertions.expectWebhookAck(res, 'ignored');
    expect((await env.api.getSubscription(id)).body.status).toBe('canceled');
    await env.persistence.expectInvoiceStatuses(id, ['pending']);
    env.providerCalls.expectNoCharges();
  });

  it('a subscription canceled by exhausted retries cannot be reactivated by a later success', async () => {
    await env.seedBilling('past_due', ['failed', 'failed', 'pending']);
    await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_3rd').forInvoice('inv_seed_003').build());
    await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');

    const res = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_late').forInvoice('inv_seed_003').build());

    BillingAssertions.expectWebhookAck(res, 'ignored');
    await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');
    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['failed', 'failed', 'failed']);
    await env.persistence.expectCoherent('sub_seed_001');
  });

  it('events with other problems (unknown invoice, wrong amount) are reported as canceled, and still change nothing', async () => {
    await env.seedBilling('active', ['paid']);
    await env.api.cancelSubscription('sub_seed_001');
    const before = await env.persistence.snapshot();

    const res = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_x').forInvoice('inv_nope').withAmount(1).build());

    BillingAssertions.expectWebhookAck(res, 'ignored');
    const after = await env.persistence.snapshot();
    expect(after.subscriptions).toEqual(before.subscriptions);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.auditLog).toEqual(before.auditLog);
    await env.persistence.expectWebhookEvent('evt_x', { outcome: 'ignored', reason: 'subscription_canceled' });
  });

  describe('payment.refunded on a canceled subscription', () => {
    it('is bookkeeping only: the invoice becomes refunded and the subscription stays canceled', async () => {
      await env.seedBilling('active', ['paid']);
      await env.api.cancelSubscription('sub_seed_001');

      const res = await env.webhooks.deliver(aWebhookEvent().refunded().withId('evt_refund').build());

      BillingAssertions.expectWebhookAck(res, 'processed');
      await env.persistence.expectInvoiceStatuses('sub_seed_001', ['refunded']);
      await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');
      await env.persistence.expectAuditTrail('sub_seed_001', [
        { from: 'active', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_seed_001');
    });
  });

  describe('a cancel racing a payment.succeeded webhook for the same subscription', () => {
    it.each([
      ['cancel first', true],
      ['webhook first', false],
    ])('ends canceled and coherent whichever is processed first, with slow storage (%s)', async (_name, cancelFirst) => {
      // Slow storage opens the read-then-write gap in which an unserialized webhook could overwrite the cancel.
      env = TestEnvironment.create({ slowStorage: true });
      await env.seedBilling('trialing', ['pending']);
      const webhook = () => env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_race').build());
      const cancel = () => env.api.cancelSubscription('sub_seed_001');

      await Promise.all(cancelFirst ? [cancel(), webhook()] : [webhook(), cancel()]);

      const final = await env.api.getSubscription('sub_seed_001');
      expect(final.body.status).toBe('canceled');
      await env.persistence.expectStoredStatus('sub_seed_001', 'canceled');
      await env.persistence.expectCoherent('sub_seed_001', final.body);
    });
  });
});
