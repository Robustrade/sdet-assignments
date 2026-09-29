import { describe, expect, it } from 'vitest';
import { aWebhook } from '../../framework/builders/WebhookEventBuilder';
import { useTestEnvironment } from '../../framework/env/TestEnvironment';

describe('payment.refunded', () => {
  const env = useTestEnvironment();

  it('F4: marks the paid invoice refunded without changing the subscription status', async () => {
    const sub = await env().given.activeSubscription();
    const charge = env().provider.lastCall();

    const res = await env().webhooks.deliver(env().simulator.signed(aWebhook().refunded().forCharge(charge).build()));

    expect(res.body).toMatchObject({ outcome: 'applied', duplicate: false });
    expect((await env().assert.expectConsistent(sub.id)).status).toBe('active');
    expect(env().db.invoicesFor(sub.id).map((i) => i.status)).toEqual(['refunded']);
    expect(env().assert.transitionsOf(sub.id)).toEqual(['∅->trialing', 'trialing->active']);
  });

  it('a second refund for the same invoice under a new event_id is stale', async () => {
    await env().given.activeSubscription();
    const charge = env().provider.lastCall();
    await env().webhooks.deliver(env().simulator.signed(aWebhook().refunded().forCharge(charge).build()));

    const again = await env().webhooks.deliver(env().simulator.signed(aWebhook().refunded().forCharge(charge).build()));

    expect(again.body).toMatchObject({ outcome: 'ignored_stale', duplicate: false });
  });

  it('a refund for an invoice that was never paid is stale', async () => {
    const sub = await env().given.pastDueSubscription();
    const charge = env().provider.lastCall();

    const res = await env().webhooks.deliver(env().simulator.signed(aWebhook().refunded().forCharge(charge).build()));

    expect(res.body).toMatchObject({ outcome: 'ignored_stale' });
    expect(env().db.invoicesFor(sub.id).map((i) => i.status)).toEqual(['failed']);
  });
});
