import { describe, expect, it } from 'vitest';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { ProviderAssertions } from '../framework/assertions/provider-assertions';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';

/**
 * LEVEL 4a — idempotency and out-of-order delivery.
 *
 * The provider is assumed to deliver at-least-once, in any order. Every test
 * here asserts the same three things about redelivery: the state moved once,
 * exactly one invoice/payment row exists, and the modelled side effect fired once.
 */
describe('Webhook idempotency', () => {
  const suite = useBillingSystem();

  it('applies a redelivered event exactly once, and keeps the duplicates auditable', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult();
    const invoice = await suite.env.latestInvoice(sub.id);
    const payload = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();
    const mark = suite.env.provider.mark();

    const responses = await suite.env.webhooks.deliverTimes(payload, 3);

    expect(responses.map((r) => r.body.status)).toEqual(['processed', 'duplicate', 'duplicate']);
    expect(responses[1].body.reason).toBe('EVENT_ALREADY_PROCESSED');

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_SUCCEEDED')
      .hasInvoiceCount(1)
      .hasPaidInvoiceCount(1)
      .hasWebhookEventCount(1)
      .hasNotificationCount('subscription_activated', 1);
    ProviderAssertions.on(suite.env.provider).wasNotCalledSince(mark);

    // One row, three deliveries: the no-op'd duplicates are recorded, not lost.
    expect(suite.env.repos.webhookEvents.findById(payload.event_id)?.delivery_count).toBe(3);
  });

  it('ignores relabelled and forged events that the replay guard cannot catch', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult();
    const invoice = await suite.env.latestInvoice(sub.id);

    await suite.env.webhooks.deliver(
      WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build()
    );

    // Same charge announced under a fresh event_id, and a forged amount.
    const relabelled = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();
    const forged = WebhookEventBuilder.anEvent()
      .succeeded()
      .forInvoice(invoice)
      .withAmount(invoice.amount - 100)
      .build();

    const relabelledResponse = await suite.env.webhooks.deliver(relabelled);
    const forgedResponse = await suite.env.webhooks.deliver(forged);

    expect(relabelledResponse.body).toMatchObject({ status: 'ignored', reason: 'INVOICE_ALREADY_PAID' });
    expect(forgedResponse.body).toMatchObject({ status: 'ignored', reason: 'AMOUNT_MISMATCH' });
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasInvoiceCount(1)
      .hasPaidInvoiceCount(1)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_SUCCEEDED')
      .hasNotificationCount('subscription_activated', 1)
      .hasWebhookEventRecorded(forged.event_id, 'ignored', 'AMOUNT_MISMATCH');
  });

  it('does not decrement the retry budget twice for a redelivered failure', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult({ plan: 'basic' });
    const invoice = await suite.env.latestInvoice(sub.id);
    const payload = WebhookEventBuilder.anEvent().failed().forInvoice(invoice).build();

    await suite.env.webhooks.deliverTimes(payload, 3);

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_FAILED')
      .hasInvoiceStatuses('failed')
      .hasNotificationCount('payment_failed', 1);
    expect(suite.env.repos.subscriptions.requireById(sub.id).retries_remaining).toBe(2);
  });

  it('refunds once, without erasing the payment that preceded it or moving the subscription', async () => {
    const sub = await suite.env.scenarios.active();
    const invoice = await suite.env.latestInvoice(sub.id);
    const payload = WebhookEventBuilder.anEvent().refunded().forInvoice(invoice).build();

    const responses = await suite.env.webhooks.deliverTimes(payload, 3);

    expect(responses.map((r) => r.body.status)).toEqual(['processed', 'duplicate', 'duplicate']);
    const refunded = suite.env.repos.invoices.requireById(invoice.id);
    expect(refunded.status).toBe('refunded');
    expect(refunded.paid_at, 'the original payment stays on record').not.toBeNull();
    expect(refunded.refunded_at).not.toBeNull();
    SubscriptionAssertions.for(suite.env, sub.id).hasNotificationCount('payment_refunded', 1);
    // A refund is an invoice-level fact: the lifecycle declares no refund edge.
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');
  });

  // BONUS: racing redelivery. This fixture processes an event synchronously, so
  // its check-then-insert of the event id cannot interleave on Node's event loop.
  // A real database needs a unique constraint on webhook_events.event_id (or a
  // row lock) for this to hold — see docs/TEST_STRATEGY.md §7.
  it('processes exactly one of four concurrently delivered copies of an event', async () => {
    const sub = await suite.env.scenarios.awaitingProviderResult();
    const invoice = await suite.env.latestInvoice(sub.id);
    const payload = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();

    const responses = await suite.env.webhooks.deliverConcurrently(payload, 4);

    const statuses = responses.map((r) => r.body.status);
    expect(statuses.filter((s) => s === 'processed')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(3);
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_SUCCEEDED')
      .hasPaidInvoiceCount(1)
      .hasNotificationCount('subscription_activated', 1);
  });
});
