import { createTestContext } from '../../src/testUtils/testAppFactory';
import { SubscriptionRequestBuilder } from '../../src/testUtils/builders/subscriptionBuilder';
import { WebhookPayloadBuilder } from '../../src/testUtils/builders/webhookPayloadBuilder';

describe('Mock payment provider interaction', () => {
  it('is called with the correct customer, payment method, and amount on a billing attempt', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    provider.setOutcome('succeeded');
    await service.runBillingAttempt(created.body.id);

    expect(provider.callCount()).toBe(1);
    const call = provider.lastCall()!;
    expect(call.customerId).toBe(created.body.customerId);
    expect(call.paymentMethodId).toBe(created.body.paymentMethodId);
    expect(call.amountCents).toBe(4900);
    expect(call.currency).toBe('USD');
    expect(call.idempotencyKey).toEqual(expect.stringContaining(created.body.id));
  });

  it('charges the plan-specific price: basic is 900 cents, pro is 4900 cents - consistent with creation-time config', async () => {
    const { api, service, provider } = createTestContext();
    const basic = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());
    const pro = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    provider.setOutcome('succeeded');
    await service.runBillingAttempt(basic.body.id);
    await service.runBillingAttempt(pro.body.id);

    expect(provider.calls[0].amountCents).toBe(900);
    expect(provider.calls[1].amountCents).toBe(4900);
  });

  it('is never called for a rejected creation', async () => {
    const { api, provider } = createTestContext();
    await api.createSubscription(new SubscriptionRequestBuilder().withPlan('not-a-real-plan').build());

    expect(provider.callCount()).toBe(0);
  });

  it('is never called by a replayed (duplicate) webhook', async () => {
    const { api, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('pro').build());

    const builder = new WebhookPayloadBuilder().withEventId('evt_replay').ofType('payment.succeeded').forSubscription(created.body.id);
    const { rawBody, signature } = builder.buildSigned();

    await api.postWebhook(rawBody, signature);
    await api.postWebhook(rawBody, signature); 

    expect(provider.callCount()).toBe(0); 
  });

  it('transitions trialing -> active when the mock reports success', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('succeeded');
    const updated = await service.runBillingAttempt(created.body.id);

    expect(updated.state).toBe('active');
  });

  it('transitions trialing -> past_due when the mock reports a decline', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('declined');
    const updated = await service.runBillingAttempt(created.body.id);

    expect(updated.state).toBe('past_due');
  });

  it('transitions trialing -> past_due when the mock times out (treated as a failed charge, not a crash)', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('timeout');
    const updated = await service.runBillingAttempt(created.body.id);

    expect(updated.state).toBe('past_due');
    expect(provider.callCount()).toBe(1);
  });

  it('the provider mock is called exactly once per genuine billing attempt, never more', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('succeeded');
    await service.runBillingAttempt(created.body.id);

    expect(provider.callCount()).toBe(1);
  });

  it('after 3 failed retries in past_due, the subscription is canceled - proven via provider call count', async () => {
    const { api, service, provider } = createTestContext();
    const created = await api.createSubscription(new SubscriptionRequestBuilder().withPlan('basic').build());

    provider.setOutcome('declined');
    await service.runBillingAttempt(created.body.id); 
    await service.runBillingAttempt(created.body.id); 
    const final = await service.runBillingAttempt(created.body.id); 

    expect(final.state).toBe('canceled');
    expect(provider.callCount()).toBe(3);
  });
});
