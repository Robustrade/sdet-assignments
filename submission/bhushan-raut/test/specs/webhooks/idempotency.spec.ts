import { describe, expect, it } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

describe('Webhook idempotency: the provider may redeliver any event', () => {
  const env = useTestEnvironment();

  it('D1: the same payment.succeeded delivered twice activates exactly once', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    const event = env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build());

    const first = await env().webhooks.deliver(event);
    const before = env().db.snapshotCounts();
    const second = await env().webhooks.deliver(event);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ outcome: 'applied', duplicate: false });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ outcome: 'applied', duplicate: true });

    const view = await env().assert.expectConsistent(subscription.id);
    expect(view.status).toBe('active');
    expect(env().assert.transitionsOf(subscription.id)).toEqual(['∅->trialing', 'trialing->active']);

    // The redelivery changed nothing except the delivery counter.
    expect(env().db.snapshotCounts()).toEqual(before);
    expect(env().db.webhookEvent(JSON.parse(event.rawBody).event_id)).toMatchObject({
      outcome: 'applied',
      delivery_count: 2,
    });
    expect(env().db.invoicesFor(subscription.id)).toEqual([expect.objectContaining({ status: 'paid' })]);
    expect(env().db.attemptsFor(subscription.id)).toEqual([expect.objectContaining({ status: 'succeeded' })]);

    // Side effects fire once; the provider is never re-charged for a webhook.
    expect(env().notifier.activationsFor(subscription.id)).toBe(1);
    expect(env().provider.calls).toHaveLength(1);
  });

  it('D2: the same payment.failed delivered twice counts one failed retry, not two', async () => {
    const { subscription, charge } = await env().given.pastDueWithPendingRetry();
    const event = env().simulator.signed(aWebhook().paymentFailed().forCharge(charge).build());

    await env().webhooks.deliver(event);
    const second = await env().webhooks.deliver(event);

    expect(second.body).toMatchObject({ duplicate: true });
    const view = await env().assert.expectConsistent(subscription.id);
    expect(view.status).toBe('past_due');
    expect(view.retry_count).toBe(1);
    expect(env().db.attemptsFor(subscription.id).map((a) => a.status)).toEqual(['failed', 'failed']);
    expect(env().provider.calls).toHaveLength(2);
  });

  it('D3: an old event redelivered after newer changes does not roll the subscription back', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    const activation = env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build());
    await env().webhooks.deliver(activation);
    expect((await env().api.cancel(subscription.id)).status).toBe(200);
    const before = env().db.snapshotCounts();

    const replay = await env().webhooks.deliver(activation);

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ duplicate: true });
    expect((await env().assert.expectConsistent(subscription.id)).status).toBe('canceled');
    expect(env().db.snapshotCounts()).toEqual(before);
    expect(env().notifier.activationsFor(subscription.id)).toBe(1);
  });

  it('D4: the same outcome re-sent under a new event_id is recognised as stale, not applied twice', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    await env().webhooks.deliver(env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build()));
    const before = env().db.snapshotCounts();

    const resent = aWebhook().paymentSucceeded().forCharge(charge).withEventId('evt_resent_by_provider').build();
    const res = await env().webhooks.deliver(env().simulator.signed(resent));

    expect(res.body).toMatchObject({ outcome: 'ignored_stale', duplicate: false });
    expect(env().db.snapshotCounts()).toEqual({ ...before, webhook_events: before.webhook_events + 1 });
    expect(env().notifier.activationsFor(subscription.id)).toBe(1);
    await env().assert.expectConsistent(subscription.id);
  });
});
