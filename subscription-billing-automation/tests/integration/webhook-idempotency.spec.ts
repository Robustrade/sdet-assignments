import { SubscriptionBuilder } from '../../framework/builders/subscription.builder';
import { WebhookPayloadBuilder } from '../../framework/builders/webhook-payload.builder';
import { createHarness } from '../test-harness';

describe('webhook idempotency and ordering', () => {
  it('records redelivery while applying a successful payment exactly once', async () => {
    const { api, provider, service, verifier } = createHarness();
    const creation = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = (creation.body as { id: string }).id;
    const event = new WebhookPayloadBuilder().forSubscription(subscriptionId).withEventId('evt_once').build();

    expect((await api.postWebhook(event)).body).toMatchObject({ received: true, applied: true });
    expect((await api.postWebhook(event)).body).toMatchObject({ received: true, duplicate: true });
    expect(service.subscriptions.findById(subscriptionId)?.status).toBe('active');
    expect(service.invoices.findBySubscriptionId(subscriptionId)).toHaveLength(1);
    expect(service.webhookEvents.all()).toHaveLength(1);
    verifier.assertWebhookDeliveries('evt_once', 2);
    verifier.assertActiveHasSuccessfulPayment(subscriptionId);
    expect(provider.calls).toHaveLength(0);
  });

  it('does not regress a successful invoice when an older failure arrives later', async () => {
    const { api, service } = createHarness();
    const creation = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = (creation.body as { id: string }).id;
    const success = new WebhookPayloadBuilder()
      .withEventId('evt_success')
      .forSubscription(subscriptionId)
      .forInvoice('inv_shared')
      .build();
    const lateFailure = new WebhookPayloadBuilder()
      .withEventId('evt_late_failure')
      .ofType('payment.failed')
      .forSubscription(subscriptionId)
      .forInvoice('inv_shared')
      .build();

    await api.postWebhook(success);
    expect((await api.postWebhook(lateFailure)).body).toMatchObject({ received: true, applied: false });
    expect(service.subscriptions.findById(subscriptionId)?.status).toBe('active');
    expect(service.invoices.findBySubscriptionId(subscriptionId)).toEqual([
      expect.objectContaining({ id: 'inv_shared', status: 'succeeded' }),
    ]);
    expect(service.webhookEvents.findById('evt_late_failure')?.outcome).toBe('ignored');
  });

  it('keeps canceled subscriptions terminal when subsequent signed events arrive', async () => {
    const { api, service, verifier } = createHarness();
    const creation = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = (creation.body as { id: string }).id;
    await api.cancelSubscription(subscriptionId);
    const lateSuccess = new WebhookPayloadBuilder()
      .withEventId('evt_after_cancel')
      .forSubscription(subscriptionId)
      .build();

    expect((await api.postWebhook(lateSuccess)).body).toMatchObject({ received: true, applied: false });
    expect(service.subscriptions.findById(subscriptionId)?.status).toBe('canceled');
    expect(service.invoices.findBySubscriptionId(subscriptionId)).toHaveLength(0);
    expect(service.webhookEvents.findById('evt_after_cancel')?.outcome).toBe('ignored');
    verifier.assertCanceledIsTerminal(subscriptionId);
  });
});
