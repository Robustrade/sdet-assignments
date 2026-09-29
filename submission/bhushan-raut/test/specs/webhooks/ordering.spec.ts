import { describe, expect, it } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

describe('Out-of-order and stray webhooks cannot break the lifecycle', () => {
  const env = useTestEnvironment();

  it('E3: payment.succeeded for a subscription canceled meanwhile does not reactivate it', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    expect((await env().api.cancel(subscription.id)).status).toBe(200);
    const before = env().db.snapshotCounts();

    const res = await env().webhooks.deliver(
      env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build()),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'ignored_invalid_transition', duplicate: false });
    const view = await env().assert.expectConsistent(subscription.id);
    expect(view.status).toBe('canceled');
    expect(env().assert.transitionsOf(subscription.id)).toEqual(['∅->trialing', 'trialing->canceled']);
    expect(env().db.invoicesFor(subscription.id).map((i) => i.status)).not.toContain('paid');
    expect(env().notifier.activationsFor(subscription.id)).toBe(0);
    // Only the event record itself is new: it is kept for audit, with its outcome.
    expect(env().db.snapshotCounts()).toEqual({ ...before, webhook_events: before.webhook_events + 1 });
  });

  it('E4: payment.failed arriving after payment.succeeded for the same invoice does not regress active', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();
    await env().webhooks.deliver(env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).build()));

    const late = await env().webhooks.deliver(
      env().simulator.signed(aWebhook().paymentFailed().forCharge(charge).build()),
    );

    expect(late.body).toMatchObject({ outcome: 'ignored_stale' });
    const view = await env().assert.expectConsistent(subscription.id);
    expect(view.status).toBe('active');
    expect(view.retry_count).toBe(0);
    expect(env().db.invoicesFor(subscription.id).map((i) => i.status)).toEqual(['paid']);
    expect(env().db.attemptsFor(subscription.id).map((a) => a.status)).toEqual(['succeeded']);
  });

  it('a webhook for an invoice that belongs to a different subscription is not applied', async () => {
    const victim = await env().given.subscriptionWithPendingFirstCharge();
    const other = await env().given.trialingSubscription();

    const res = await env().webhooks.deliver(
      env().simulator.signed(
        aWebhook().paymentSucceeded().forCharge(victim.charge).with('subscription_id', other.id).build(),
      ),
    );

    expect(res.body).toMatchObject({ outcome: 'ignored_unknown_reference' });
    expect((await env().assert.expectConsistent(victim.subscription.id)).status).toBe('trialing');
    expect((await env().assert.expectConsistent(other.id)).status).toBe('trialing');
  });

  it('a webhook whose amount disagrees with the invoice is not applied', async () => {
    const { subscription, charge } = await env().given.subscriptionWithPendingFirstCharge();

    const res = await env().webhooks.deliver(
      env().simulator.signed(aWebhook().paymentSucceeded().forCharge(charge).with('amount', 1).build()),
    );

    expect(res.body).toMatchObject({ outcome: 'ignored_amount_mismatch' });
    expect((await env().assert.expectConsistent(subscription.id)).status).toBe('trialing');
    expect(env().db.attemptsFor(subscription.id).map((a) => a.status)).toEqual(['pending']);
  });
});
