import { WebhookEventBuilder } from '../../builders/webhook-event.builder';
import { SubscriptionTestFixture } from '../support/subscription-test-fixture';

describe('Subscription API quality and billing invariants', () => {
  let fixture: SubscriptionTestFixture;

  beforeEach(() => {
    fixture = new SubscriptionTestFixture();
  });

  afterEach(() => {
    fixture.close();
  });

  it('rejects invalid subscription requests without persistence or provider calls', async () => {
    const missingCustomer = await fixture.api.createSubscription({
      plan: 'basic'
    });
    const unsupportedPlan = await fixture.api.createSubscription({
      customer_id: 'customer-invalid-plan',
      plan: 'enterprise'
    });
    const missingPlan = await fixture.api.createSubscription({
      customer_id: 'customer-missing-plan'
    });

    expect(missingCustomer.status).toBe(400);
    expect(missingCustomer.body.error).toBe('Customer ID is required');
    expect(unsupportedPlan.status).toBe(400);
    expect(unsupportedPlan.body.error).toBe('Invalid subscription plan');
    expect(missingPlan.status).toBe(400);
    expect(missingPlan.body.error).toBe('Invalid subscription plan');
    expect(fixture.persistence.count('subscriptions')).toBe(0);
    expect(fixture.provider.calls).toHaveLength(0);
  });

  it('charges a pro plan once for the expected amount and persists a coherent success', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-pro-001',
      plan: 'pro'
    });

    const response = await fixture.api.pay(created.body.id);
    const subscription = fixture.persistence.subscription(created.body.id);
    const [invoice] = fixture.persistence.invoicesFor(created.body.id);
    const [payment] = fixture.persistence.paymentsFor(invoice.id);
    const audit = fixture.persistence.auditFor(created.body.id);
    const storedSubscription = await fixture.api.getSubscription(created.body.id);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('active');
    expect(subscription?.status).toBe(response.body.status);
    expect(storedSubscription.body.status).toBe(response.body.status);
    expect(invoice).toMatchObject({ amount: 2500, status: 'succeeded' });
    expect(payment).toMatchObject({ amount: 2500, status: 'succeeded' });
    expect(payment.transaction_id).toMatch(/^txn-/);
    expect(Date.parse(subscription!.created_at)).not.toBeNaN();
    expect(Date.parse(subscription!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(subscription!.created_at)
    );
    expect(Date.parse(invoice.created_at)).not.toBeNaN();
    expect(Date.parse(payment.created_at)).not.toBeNaN();
    expect(fixture.provider.calls).toEqual([{
      customerId: 'customer-pro-001',
      amount: 2500,
      currency: 'USD'
    }]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      old_status: 'trialing',
      new_status: 'active',
      reason: 'Payment successful'
    });
  });

  it('records provider timeout as a failed billing attempt without activating the subscription', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-timeout-001',
      plan: 'basic'
    });
    fixture.provider.setNextStatus('timeout');

    const response = await fixture.api.pay(created.body.id);
    const [invoice] = fixture.persistence.invoicesFor(created.body.id);
    const [payment] = fixture.persistence.paymentsFor(invoice.id);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Payment provider timeout');
    expect(fixture.persistence.subscription(created.body.id)?.status)
      .toBe('trialing');
    expect(invoice).toMatchObject({ amount: 1000, status: 'timeout' });
    expect(payment).toMatchObject({ amount: 1000, status: 'timeout' });
    expect(fixture.provider.calls).toEqual([{
      customerId: 'customer-timeout-001',
      amount: 1000,
      currency: 'USD'
    }]);
    expect(fixture.persistence.auditFor(created.body.id)).toHaveLength(0);
  });

  it('moves trialing to past_due on decline and back to active on a successful retry', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-retry-001',
      plan: 'basic'
    });
    fixture.provider.setNextStatus('declined');

    const failedAttempt = await fixture.api.pay(created.body.id);
    expect(fixture.persistence.subscription(created.body.id)?.status)
      .toBe(failedAttempt.body.status);
    const retryAttempt = await fixture.api.pay(created.body.id);
    const invoices = fixture.persistence.invoicesFor(created.body.id);
    const audit = fixture.persistence.auditFor(created.body.id);

    expect(failedAttempt.body.status).toBe('past_due');
    expect(retryAttempt.body.status).toBe('active');
    expect(fixture.persistence.subscription(created.body.id)?.status)
      .toBe('active');
    expect(invoices.map(({ status }) => status)).toEqual(['failed', 'succeeded']);
    expect(fixture.provider.calls).toHaveLength(2);
    expect(fixture.provider.calls).toEqual([
      { customerId: 'customer-retry-001', amount: 1000, currency: 'USD' },
      { customerId: 'customer-retry-001', amount: 1000, currency: 'USD' }
    ]);
    expect(audit.map(({ old_status, new_status }) => [old_status, new_status]))
      .toEqual([['trialing', 'past_due'], ['past_due', 'active']]);
  });

  it('does not call the provider when charging a canceled subscription is rejected', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-canceled-001',
      plan: 'basic'
    });
    await fixture.api.cancelSubscription(created.body.id);

    const response = await fixture.api.pay(created.body.id);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Cannot charge a canceled subscription');
    expect(fixture.provider.calls).toHaveLength(0);
    expect(fixture.persistence.invoicesFor(created.body.id)).toHaveLength(0);
  });

  it('keeps a canceled subscription canceled when a valid success webhook arrives', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-canceled-webhook-001',
      plan: 'basic'
    });
    const invoiceId = 'invoice-canceled-success-001';
    fixture.persistence.seedPaymentAttempt(
      created.body.id,
      invoiceId,
      'payment-canceled-success-001'
    );
    await fixture.api.cancelSubscription(created.body.id);

    const payload = new WebhookEventBuilder()
      .withEventId('event-canceled-success-001')
      .withSubscriptionId(created.body.id)
      .withInvoiceId(invoiceId)
      .build();
    const response = await fixture.api.sendWebhook(payload);
    const invoice = fixture.persistence.invoicesFor(created.body.id)[0];
    const [payment] = fixture.persistence.paymentsFor(invoiceId);
    const storedSubscription = fixture.persistence.subscription(created.body.id);
    const apiSubscription = await fixture.api.getSubscription(created.body.id);

    expect(response.status).toBe(200);
    expect(storedSubscription?.status).toBe('canceled');
    expect(apiSubscription.body.status).toBe('canceled');
    expect(storedSubscription?.canceled_at).not.toBeNull();
    expect(invoice.status).toBe('succeeded');
    expect(payment.status).toBe('succeeded');
    expect(fixture.persistence.webhookEventCount(payload.event_id)).toBe(1);
    expect(fixture.persistence.auditFor(created.body.id)).toHaveLength(1);
    expect(fixture.provider.calls).toHaveLength(0);
  });

  it('rejects signed malformed and unsupported webhook payloads without side effects', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-malformed-webhook-001',
      plan: 'basic'
    });
    const malformed = await fixture.api.sendWebhook({
      event_id: '',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'invoice-malformed-001'
    });
    const unsupported = await fixture.api.sendWebhook({
      event_id: 'event-unsupported-001',
      type: 'payment.chargeback',
      subscription_id: created.body.id,
      invoice_id: 'invoice-unsupported-001'
    });

    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('Invalid webhook payload');
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error).toBe('Invalid webhook payload');
    expect(fixture.persistence.subscription(created.body.id)?.status)
      .toBe('trialing');
    expect(fixture.persistence.count('webhook_events')).toBe(0);
    expect(fixture.persistence.count('invoices')).toBe(0);
    expect(fixture.persistence.count('payments')).toBe(0);
  });

  it('rejects missing webhook signatures without recording the event', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-unsigned-webhook-001',
      plan: 'basic'
    });
    const payload = new WebhookEventBuilder()
      .withEventId('event-unsigned-001')
      .withSubscriptionId(created.body.id)
      .build();

    const response = await fixture.api.sendWebhook(payload, 'missing');

    expect(response.status).toBe(401);
    expect(fixture.persistence.webhookEventCount(payload.event_id)).toBe(0);
    expect(fixture.persistence.subscription(created.body.id)?.status)
      .toBe('trialing');
  });

  it('does not repeat webhook side effects when an event is delivered twice', async () => {
    const created = await fixture.api.createSubscription({
      customer_id: 'customer-duplicate-webhook-001',
      plan: 'basic'
    });
    const invoiceId = 'invoice-duplicate-quality-001';
    fixture.persistence.seedPaymentAttempt(
      created.body.id,
      invoiceId,
      'payment-duplicate-quality-001'
    );
    const payload = new WebhookEventBuilder()
      .withEventId('event-duplicate-quality-001')
      .withSubscriptionId(created.body.id)
      .withInvoiceId(invoiceId)
      .build();

    const first = await fixture.api.sendWebhook(payload);
    const replay = await fixture.api.sendWebhook(payload);

    expect(first.body.duplicate).toBe(false);
    expect(replay.body.duplicate).toBe(true);
    expect(fixture.persistence.webhookEventCount(payload.event_id)).toBe(1);
    expect(fixture.persistence.invoicesFor(created.body.id)).toHaveLength(1);
    expect(fixture.persistence.paymentsFor(invoiceId)).toHaveLength(1);
    expect(fixture.persistence.auditFor(created.body.id)).toHaveLength(1);
    expect(fixture.provider.calls).toHaveLength(0);
  });
});
