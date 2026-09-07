import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';

describe('Concurrent webhook delivery (bonus)', () => {
  it('two different payment.failed events fired concurrently against the same active subscription apply exactly once each, never double-jumping state', async () => {
    const {
      api, service, provider, store,
    } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    provider.setOutcome('succeeded');
    await service.runBillingAttempt(created.body.id); // trialing -> active

    const first = new WebhookPayloadBuilder()
      .withEventId('evt_concurrent_1').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    const second = new WebhookPayloadBuilder()
      .withEventId('evt_concurrent_2').ofType('payment.failed').forSubscription(created.body.id).buildSigned();

    const [resA, resB] = await Promise.all([
      api.postWebhook(first.rawBody, first.signature),
      api.postWebhook(second.rawBody, second.signature),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');
    expect(store.subscriptions.get(created.body.id)?.failedChargeCount).toBe(2);
    expect(store.webhookEvents.get('evt_concurrent_1')).toBeDefined();
    expect(store.webhookEvents.get('evt_concurrent_2')).toBeDefined();
    expect(store.invoices.forSubscription(created.body.id)).toHaveLength(3);
    expect(store.invoices.forSubscription(created.body.id).filter((i) => i.status === 'paid')).toHaveLength(1);
    expect(store.invoices.forSubscription(created.body.id).filter((i) => i.status === 'failed')).toHaveLength(2);
  });

  it('the exact same event_id delivered twice concurrently (a true redelivery race) is still applied only once', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .withEventId('evt_dup_concurrent').ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();

    const [resA, resB] = await Promise.all([
      api.postWebhook(rawBody, signature),
      api.postWebhook(rawBody, signature),
    ]);

    const noops = [resA.body.noop, resB.body.noop].sort();
    expect(noops).toEqual([false, true]);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');
  });
});
