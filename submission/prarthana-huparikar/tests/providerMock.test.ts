import { SubscriptionService } from '../src/service/SubscriptionService';
import { SubscriptionRepository, InvoiceRepository, WebhookEventRepository } from '../src/service/Repository';
import { MockPaymentProvider } from '../src/infra/MockPaymentProvider';
import { SubscriptionBuilder } from '../src/testing/builders/SubscriptionBuilder';

describe('Mock payment provider interaction', () => {
  let provider: MockPaymentProvider;
  let service: SubscriptionService;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    service = new SubscriptionService(
      new SubscriptionRepository(),
      new InvoiceRepository(),
      new WebhookEventRepository(),
      provider,
    );
  });

  test('provider is called exactly once for a genuine trial-end billing attempt', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    await service.triggerTrialEnd(sub.id);

    expect(provider.callCount()).toBe(1);
    expect(provider.calls[0]).toMatchObject({
      customerId: sub.customerId,
      paymentMethodId: sub.paymentMethodId,
      amountCents: 4900, // pro plan
      currency: 'USD',
    });
  });

  test('provider is NOT called for subscription creation itself', async () => {
    await service.createSubscription(new SubscriptionBuilder().build());
    expect(provider.callCount()).toBe(0);
  });

  test('a decline outcome moves the subscription to past_due, not active', async () => {
    provider.setOutcome('decline');
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    const updated = await service.triggerTrialEnd(sub.id);
    expect(updated.status).toBe('past_due');
  });

  test('a provider timeout is surfaced as an error, not silently treated as success', async () => {
    provider.setOutcome('timeout');
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    await expect(service.triggerTrialEnd(sub.id)).rejects.toThrow('provider_timeout');
  });

  test('replaying an already-processed webhook does not call the provider at all', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    const { WebhookPayloadBuilder } = await import('../src/testing/builders/WebhookPayloadBuilder');
    const payload = new WebhookPayloadBuilder().forSubscription(sub.id).withType('payment.succeeded').build();

    await service.handleWebhook(payload);
    await service.handleWebhook(payload); // duplicate

    // Webhooks never call the provider in this design (the provider is only
    // called for outbound charge attempts), so this asserts call count stays
    // at the baseline regardless of how many times the webhook replays.
    expect(provider.callCount()).toBe(0);
  });
});
