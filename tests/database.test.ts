import { SubscriptionService } from '../src/service/SubscriptionService';
import { SubscriptionRepository, InvoiceRepository, WebhookEventRepository } from '../src/service/Repository';
import { MockPaymentProvider } from '../src/infra/MockPaymentProvider';
import { SubscriptionBuilder } from '../src/testing/builders/SubscriptionBuilder';
import { WebhookPayloadBuilder } from '../src/testing/builders/WebhookPayloadBuilder';

describe('Persistence / database invariants', () => {
  let provider: MockPaymentProvider;
  let subs: SubscriptionRepository;
  let invoices: InvoiceRepository;
  let webhookEvents: WebhookEventRepository;
  let service: SubscriptionService;

  beforeEach(() => {
    provider = new MockPaymentProvider();
    subs = new SubscriptionRepository();
    invoices = new InvoiceRepository();
    webhookEvents = new WebhookEventRepository();
    service = new SubscriptionService(subs, invoices, webhookEvents, provider);
  });

  test('an active subscription never exists without at least one succeeded invoice', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    await service.triggerTrialEnd(sub.id);

    const persisted = subs.findById(sub.id)!;
    if (persisted.status === 'active') {
      const hasSucceeded = invoices.findBySubscription(sub.id).some((i) => i.status === 'succeeded');
      expect(hasSucceeded).toBe(true);
    }
  });

  test('duplicate webhook delivery never produces a duplicate invoice row', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    const payload = new WebhookPayloadBuilder().forSubscription(sub.id).withType('payment.succeeded').build();

    await service.handleWebhook(payload);
    await service.handleWebhook(payload);

    expect(invoices.findBySubscription(sub.id)).toHaveLength(1);
  });

  test('every webhook event_id is recorded exactly once, including no-op duplicates', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    const payload = new WebhookPayloadBuilder().forSubscription(sub.id).withType('payment.succeeded').build();

    await service.handleWebhook(payload);
    await service.handleWebhook(payload);
    await service.handleWebhook(payload);

    expect(webhookEvents.all().filter((e) => e.eventId === payload.event_id)).toHaveLength(1);
  });

  test('persisted subscription state always matches the value returned to the caller', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    const updated = await service.triggerTrialEnd(sub.id);
    const persisted = subs.findById(sub.id);

    expect(persisted?.status).toBe(updated.status);
    expect(persisted?.updatedAt).toBe(updated.updatedAt);
  });

  test('no contradictory records: a canceled subscription accrues no further invoices from webhooks', async () => {
    const sub = await service.createSubscription(new SubscriptionBuilder().build());
    await service.cancelSubscription(sub.id);

    const payload = new WebhookPayloadBuilder().forSubscription(sub.id).withType('payment.succeeded').build();
    await service.handleWebhook(payload);

    expect(invoices.findBySubscription(sub.id)).toHaveLength(0);
  });
});
