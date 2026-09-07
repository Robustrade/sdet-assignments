import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';

describe('Every lifecycle transition, driven through the real HTTP layer', () => {
  it('trialing -> active: inbound payment.succeeded webhook', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();

    const res = await api.postWebhook(rawBody, signature);

    expect(res.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');
  });

  it('trialing -> past_due: inbound payment.failed webhook', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const { rawBody, signature } = new WebhookPayloadBuilder()
      .ofType('payment.failed').forSubscription(created.body.id).buildSigned();

    const res = await api.postWebhook(rawBody, signature);

    expect(res.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');
  });

  it('active -> past_due: inbound payment.failed webhook for a genuinely new charge', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const activated = new WebhookPayloadBuilder()
      .withEventId('evt_a1').withInvoiceId('inv_a1').ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(activated.rawBody, activated.signature); // trialing -> active

    const recurringFailure = new WebhookPayloadBuilder()
      .withEventId('evt_a2').withInvoiceId('inv_a2').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    const res = await api.postWebhook(recurringFailure.rawBody, recurringFailure.signature);

    expect(res.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');
  });

  it('past_due -> active: inbound payment.succeeded webhook after a prior failure', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const failed = new WebhookPayloadBuilder()
      .withEventId('evt_b1').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(failed.rawBody, failed.signature); // trialing -> past_due
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');

    const retrySucceeded = new WebhookPayloadBuilder()
      .withEventId('evt_b2').ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    const res = await api.postWebhook(retrySucceeded.rawBody, retrySucceeded.signature);

    expect(res.body.noop).toBe(false);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');
  });

  it('past_due -> canceled: three consecutive inbound payment.failed webhooks exhaust retries', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    const first = new WebhookPayloadBuilder().withEventId('evt_c1').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(first.rawBody, first.signature); // trialing -> past_due (failure 1)
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');

    const second = new WebhookPayloadBuilder().withEventId('evt_c2').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(second.rawBody, second.signature); // stays past_due (failure 2)
    expect(store.subscriptions.get(created.body.id)?.state).toBe('past_due');

    const third = new WebhookPayloadBuilder().withEventId('evt_c3').ofType('payment.failed').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(third.rawBody, third.signature); // retries exhausted -> canceled (failure 3)

    expect(store.subscriptions.get(created.body.id)?.state).toBe('canceled');
  });

  it('trialing -> canceled: API cancel', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    expect(store.subscriptions.get(created.body.id)?.state).toBe('trialing');

    const res = await api.cancelSubscription(created.body.id);

    expect(res.body.state).toBe('canceled');
  });

  it('active -> canceled: API cancel', async () => {
    const { api, store } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());
    const activated = new WebhookPayloadBuilder()
      .ofType('payment.succeeded').forSubscription(created.body.id).buildSigned();
    await api.postWebhook(activated.rawBody, activated.signature);
    expect(store.subscriptions.get(created.body.id)?.state).toBe('active');

    const res = await api.cancelSubscription(created.body.id);

    expect(res.body.state).toBe('canceled');
  });
});
