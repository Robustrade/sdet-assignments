import { describe, expect, it } from 'vitest';
import { expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { WebhookEventBuilder } from '../../support/builders/builders';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('Webhook idempotency — duplicate event_id delivery', () => {
  const env = useTestEnvironment();

  it('payment.succeeded delivered twice: one transition, one payment, one email, a recorded no-op', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
    const event = WebhookEventBuilder.paymentSucceeded(invoice).build();
    const providerCalls = env().provider.callCount;

    const first = await env().webhooks.deliverOk(event);
    const afterFirst = env().db.counts();
    const second = await env().webhooks.deliverOk(event);

    expect([first.outcome, second.outcome]).toEqual(['applied', 'duplicate']);
    // The only thing a duplicate writes is its delivery record.
    expectRowDeltas(afterFirst, env().db.counts(), { webhook_deliveries: 1 });
    expect(env().db.deliveriesFor(event.event_id).map((d) => d.is_duplicate)).toEqual([0, 1]);
    expect(env().db.webhookEvents()).toHaveLength(1);

    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid'], history: ['∅->trialing', 'trialing->active'] });
    expect(env().db.attemptsFor(invoice.id).filter((a) => a.status === 'succeeded')).toHaveLength(1);
    expect(env().db.notificationsFor(subscription.id).map((n) => n.kind)).toEqual(['subscription_activated']);
    expect(env().provider.callCount).toBe(providerCalls);
  });

  it('payment.failed delivered twice does not burn two retries', async () => {
    const { subscription, invoice } = await env().given.awaitingRetryOutcome();
    const event = WebhookEventBuilder.paymentFailed(invoice).build();

    await env().webhooks.deliverOk(event);
    await env().webhooks.deliverOk(event);

    await expectSubscriptionState(env(), subscription.id, { status: 'past_due', retryCount: 1 });
    expect(env().db.notificationsFor(subscription.id).filter((n) => n.kind === 'payment_failed')).toHaveLength(2); // initial decline + this retry
  });

  it('payment.refunded delivered twice refunds and notifies once', async () => {
    const active = await env().given.active();
    const invoice = await env().given.latestInvoice(active.id);
    const event = WebhookEventBuilder.paymentRefunded(invoice).build();

    await env().webhooks.deliverOk(event);
    const second = await env().webhooks.deliverOk(event);

    expect(second.outcome).toBe('duplicate');
    expect(env().db.invoice(invoice.id)!.status).toBe('refunded');
    expect(env().db.notificationsFor(active.id).filter((n) => n.kind === 'payment_refunded')).toHaveLength(1);
    expect(env().db.auditTrail(active.id).filter((e) => e.event_type === 'invoice_refunded')).toHaveLength(1);
  });

  it('five concurrent redeliveries of the same event are applied exactly once', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
    const event = WebhookEventBuilder.paymentSucceeded(invoice).build();

    const acks = await Promise.all(Array.from({ length: 5 }, () => env().webhooks.deliverOk(event)));

    expect(acks.map((a) => a.outcome).sort()).toEqual(['applied', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    expect(env().db.deliveriesFor(event.event_id)).toHaveLength(5);
    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid'] });
    expect(env().db.notificationsFor(subscription.id)).toHaveLength(1);
  });

  it('a redelivery with the same event_id but a different body is still a duplicate; the first payload is kept', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
    const original = WebhookEventBuilder.paymentSucceeded(invoice).build();
    await env().webhooks.deliverOk(original);

    const conflicting = { ...original, type: 'payment.failed', failure_code: 'card_declined' };
    const ack = await env().webhooks.deliverOk(conflicting);

    expect(ack.outcome).toBe('duplicate');
    expect(env().db.webhookEvent(original.event_id)!.payload).toBe(JSON.stringify(original));
    await expectSubscriptionState(env(), subscription.id, { status: 'active' });
  });

  it('the same fact under a new event_id is recorded but not re-applied', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
    await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

    const ack = await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

    expect(ack).toMatchObject({ outcome: 'ignored', reason: 'invoice_not_open' });
    expect(env().db.webhookEvents().map((e) => e.outcome)).toEqual(['applied', 'ignored']);
    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid'] });
  });

  it('a webhook confirming a charge the provider already confirmed synchronously is a no-op', async () => {
    const active = await env().given.active();
    const invoice = await env().given.latestInvoice(active.id);
    const before = env().db.counts();

    const ack = await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

    expect(ack.reason).toBe('invoice_not_open');
    expectRowDeltas(before, env().db.counts(), { webhook_events: 1, webhook_deliveries: 1 });
  });

  it('the database rejects a second webhook_events row for the same event_id', async () => {
    const { invoice } = await env().given.awaitingFirstChargeOutcome();
    const event = WebhookEventBuilder.paymentSucceeded(invoice).build();
    await env().webhooks.deliverOk(event);

    expect(() =>
      env().db.unsafeExecute(
        "INSERT INTO webhook_events (event_id, type, payload, outcome, received_at) VALUES (?, 'payment.succeeded', '{}', 'applied', '2026-01-01')",
        [event.event_id],
      ),
    ).toThrow(/UNIQUE constraint failed: webhook_events.event_id/);
  });
});
