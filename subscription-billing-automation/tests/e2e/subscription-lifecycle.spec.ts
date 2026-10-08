import { SubscriptionBuilder } from '../../framework/builders/subscription.builder';
import { WebhookPayloadBuilder } from '../../framework/builders/webhook-payload.builder';
import { PaymentWebhookType } from '../../src/domain/models/webhook-event.model';
import { createHarness } from '../test-harness';

describe('subscription lifecycle end-to-end', () => {
  it('moves a subscription through the billing lifecycle', async () => {
    const { api, service, verifier } = createHarness();

    const created = await api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const subscriptionId = created.body.id;

    expect(created.body.status).toBe('trialing');
    verifier.assertApiMatchesPersistence(subscriptionId, created);

    const steps: Array<{
      eventId: string;
      type: PaymentWebhookType;
      invoiceId: string;
      expected: 'trialing' | 'active' | 'past_due' | 'canceled';
    }> = [
      { eventId: 'evt_first_payment', type: 'payment.succeeded', invoiceId: 'inv_first_payment', expected: 'active' },
      { eventId: 'evt_recurring_failure', type: 'payment.failed', invoiceId: 'inv_recurring_failure', expected: 'past_due' },
      { eventId: 'evt_retry_success', type: 'payment.succeeded', invoiceId: 'inv_retry_success', expected: 'active' },
      { eventId: 'evt_retry_failure', type: 'payment.failed', invoiceId: 'inv_retry_failure', expected: 'past_due' },
      { eventId: 'evt_retries_exhausted', type: 'payment.failed', invoiceId: 'inv_retries_exhausted', expected: 'canceled' },
    ];

    for (const step of steps) {
      const payloadBuilder = new WebhookPayloadBuilder()
        .withEventId(step.eventId)
        .ofType(step.type)
        .forSubscription(subscriptionId)
        .forInvoice(step.invoiceId);

      if (step.eventId === 'evt_retries_exhausted') {
        payloadBuilder.retriesExhausted();
      }

      const response = await api.postWebhook(payloadBuilder.build());
      expect(response.statusCode).toBe(200);

      const refreshed = await api.getSubscription(subscriptionId);
      expect(refreshed.body.status).toBe(step.expected);
      verifier.assertApiMatchesPersistence(subscriptionId, refreshed);
    }

    const persisted = service.subscriptions.findById(subscriptionId);
    expect(persisted?.status).toBe('canceled');
    expect(service.webhookEvents.all()).toHaveLength(5);
    verifier.assertCanceledIsTerminal(subscriptionId);
  });

  it('moves a failed trial to past_due and allows API cancellation for active plans', async () => {
    const trialHarness = createHarness();
    const trialSubscription = await trialHarness.api.createSubscription(new SubscriptionBuilder().buildCreatePayload());
    const trialId = trialSubscription.body.id;

    await trialHarness.api.postWebhook(
      new WebhookPayloadBuilder()
        .withEventId('evt_trial_failure')
        .ofType('payment.failed')
        .forSubscription(trialId)
        .build(),
    );

    expect(trialHarness.service.subscriptions.findById(trialId)?.status).toBe('past_due');

    const activeHarness = createHarness();
    const activeSubscription = await activeHarness.api.createSubscription(new SubscriptionBuilder().onPlan('pro').buildCreatePayload());
    const activeId = activeSubscription.body.id;

    const cancelResponse = await activeHarness.api.cancelSubscription(activeId);
    expect(cancelResponse.body.status).toBe('canceled');

    const finalState = await activeHarness.api.getSubscription(activeId);
    expect(finalState.body.status).toBe('canceled');
  });
});
