import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';

describe('End-to-end subscription lifecycle', () => {
  it('trial -> active happy path: API create, provider charge, invoice + audit trail persisted, API reflects it', async () => {
    const {
      api, service, store, provider,
    } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    expect(created.body.state).toBe('trialing');

    provider.setOutcome('succeeded');
    const updated = await service.runBillingAttempt(created.body.id);
    expect(updated.state).toBe('active');
    expect(provider.callCount()).toBe(1);
    expect(store.invoices.forSubscription(created.body.id)[0].status).toBe('paid');

    const getRes = await api.getSubscription(created.body.id);
    expect(getRes.body.state).toBe('active'); // API view matches persisted state

    const audit = store.auditLog.forSubscription(created.body.id);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['created', 'billing_attempt']));
  });

  it('trial -> past_due -> repeated retry failures -> canceled, with one failed invoice per attempt', async () => {
    const {
      api, service, store, provider,
    } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('declined');
    await service.runBillingAttempt(created.body.id);
    await service.runBillingAttempt(created.body.id);
    const final = await service.runBillingAttempt(created.body.id);

    expect(final.state).toBe('canceled');
    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(3);
    expect(invoices.every((i) => i.status === 'failed')).toBe(true);
  });

  it('a canceled subscription ignores a late (out-of-order/stale) payment.succeeded webhook end to end', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    await api.cancelSubscription(created.body.id);

    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    const res = await api.postWebhook(rawBody, signature);

    expect(res.status).toBe(200);
    expect(res.body.noop).toBe(true);
    expect(store.invoices.forSubscription(created.body.id)).toHaveLength(0);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('canceled'); 
  });

  it('rejects an unsigned webhook end to end with zero side effects', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const { rawBody, payload } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();

    const res = await api.postWebhook(rawBody); 

    expect(res.status).toBe(401);
    expect(store.webhookEvents.get(payload.event_id)).toBeUndefined();
    expect(store.subscriptions.get(created.body.id)?.state).toBe('trialing');
  });

  it('a payment.refunded webhook marks the invoice refunded but never changes subscription state', async () => {
    const {
      api, service, store, provider,
    } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    provider.setOutcome('succeeded');
    await service.runBillingAttempt(created.body.id); // trialing -> active, 1 paid invoice

    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.refunded').forSubscription(created.body.id).buildSigned();
    const res = await api.postWebhook(rawBody, signature);

    expect(res.status).toBe(200);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active'); // unchanged
    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices[invoices.length - 1].status).toBe('refunded');
  });

  it('a stale/out-of-order payment.failed for an already-succeeded invoice does not regress an active subscription', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    const succeeded = new WebhookPayloadBuilder()
      .withEventId('evt_success_001').withInvoiceId('inv_shared_001')
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    const succeededRes = await api.postWebhook(succeeded.rawBody, succeeded.signature);
    expect(succeededRes.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');

    const staleFailed = new WebhookPayloadBuilder()
      .withEventId('evt_stale_failure_002').withInvoiceId('inv_shared_001')
      .ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    const staleRes = await api.postWebhook(staleFailed.rawBody, staleFailed.signature);

    expect(staleRes.body.noop).toBe(true);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active'); 
    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('paid');
  });

  it('a payment.failed for a genuinely new invoice still moves an active subscription to past_due', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    const succeeded = new WebhookPayloadBuilder()
      .withEventId('evt_success_a').withInvoiceId('inv_period_1')
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(succeeded.rawBody, succeeded.signature);

    const nextPeriodFailed = new WebhookPayloadBuilder()
      .withEventId('evt_failure_b').withInvoiceId('inv_period_2') // a new billing period, new invoice
      .ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    const res = await api.postWebhook(nextPeriodFailed.rawBody, nextPeriodFailed.signature);

    expect(res.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');

    const invoices = store.invoices.forSubscription(created.body.id);
    expect(invoices).toHaveLength(2);
    expect(invoices.find((i) => i.id === 'inv_period_1')?.status).toBe('paid');
    expect(invoices.find((i) => i.id === 'inv_period_2')?.status).toBe('failed');
  });
});
