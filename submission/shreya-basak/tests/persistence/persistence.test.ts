import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';

describe('Persistence', () => {
  it('subscription row reflects plan and current lifecycle state', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    const persisted = store.subscriptions.get(created.body.id);

    expect(persisted?.plan).toBe('basic');
    expect(persisted?.state).toBe(created.body.state);
  });

  it('writes exactly one invoice per billing attempt, with correct amount/currency', async () => {
    const { api, service, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    await service.runBillingAttempt(created.body.id);

    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amountCents).toBe(4900);
    expect(invoices[0].currency).toBe('USD');
    expect(invoices[0].status).toBe('paid');
  });

  it('records a webhook_events row, keyed by event_id, and an invoice row keyed by invoice_id, for a processed inbound webhook', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const { rawBody, signature, payload } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(created.body.id).withAmount(4900).buildSigned();

    await api.postWebhook(rawBody, signature);

    const eventRecord = store.webhookEvents.get(payload.event_id);
    expect(eventRecord).toBeDefined();
    expect(eventRecord?.processed).toBe(true);
    expect(eventRecord?.noop).toBe(false); 

    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(payload.invoice_id);
    expect(invoices[0].status).toBe('paid');
    expect(invoices[0].amountCents).toBe(4900);
  });

  it('a redelivered (duplicate) event_id is a proven no-op: the invoice is written exactly once, not twice, and the provider is never touched', async () => {
    const { api, store, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    const { rawBody, signature, payload } = new WebhookPayloadBuilder()
      .withEventId('evt_fixed_001').withInvoiceId('inv_fixed_001')
      .ofType('payment.succeeded').forSubscription(created.body.id).withAmount(4900).buildSigned();

    const first = await api.postWebhook(rawBody, signature);
    const second = await api.postWebhook(rawBody, signature); 

    expect(first.body.noop).toBe(false); 
    expect(second.body.noop).toBe(true); 

    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(payload.invoice_id);
    expect(invoices[0].status).toBe('paid');
    expect(provider.callCount()).toBe(0); 
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');
  });

  it('appends an audit log entry for created and for a subsequent cancellation', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    await api.cancelSubscription(created.body.id);

    const entries = store.auditLog.forSubscription(created.body.id);
    expect(entries.some((e) => e.action === 'created')).toBe(true);
    expect(entries.some((e) => e.action === 'api_cancel' && e.toState === 'canceled')).toBe(true);
  });

  describe('no contradictory records (auditability invariant)', () => {
    it('a subscription in "active" always has at least one paid invoice on record', async () => {
      const { api, service, store } = createTestContext();
      const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

      await service.runBillingAttempt(created.body.id);

      const persisted = store.subscriptions.get(created.body.id)!;
      const invoices = store.invoices.forSubscription(created.body.id);
      if (persisted.state === 'active') {
        expect(invoices.some((i) => i.status === 'paid')).toBe(true);
      }
    });

    it('a subscription that only ever had failed charges is never "active"', async () => {
      const { api, service, provider, store } = createTestContext();
      const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

      provider.setOutcome('declined');
      await service.runBillingAttempt(created.body.id);

      const persisted = store.subscriptions.get(created.body.id)!;
      const invoices = store.invoices.forSubscription(created.body.id);
      expect(invoices.every((i) => i.status === 'failed')).toBe(true);
      expect(persisted.state).not.toBe('active');
    });
  });
});
