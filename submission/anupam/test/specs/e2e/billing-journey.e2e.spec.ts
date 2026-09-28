import { TestEnvironment } from '../../support/TestEnvironment';
import { paymentFailed, paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

/**
 * One long, realistic journey through HTTP API + scheduler + provider mock +
 * signed webhooks (including duplicates and stale/out-of-order events),
 * asserting persistence and provider interaction at the end.
 */
describe('E2E: full billing journey', () => {
  it('signup -> trial -> timeout -> failed webhook -> retry -> renewal -> cancel -> stray webhook', async () => {
    const env = TestEnvironment.create();

    // 1. signup on basic (trial)
    const sub = await env.given.trialingSubscription();

    // 2. trial ends, provider times out -> unknown outcome
    env.clock.advanceDays(14);
    env.provider.willTimeout();
    await env.runBilling(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'trialing');

    // 3. provider later reports failure (delivered twice)
    const trialInvoice = await env.given.refresh(sub.id);
    await env.webhooks.deliverTimes(paymentFailed().forLatestInvoiceOf(trialInvoice).build(), 2);
    await env.verify.expectSubscriptionIn(sub.id, 'past_due');

    // 4. scheduler retries next day, succeeds
    env.clock.advanceDays(1);
    env.provider.willSucceed();
    await env.runBilling(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'active');

    // 5. provider's own success webhook for that invoice arrives late -> no-op
    const late = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(trialInvoice).build());
    expect(late.body.reason).toBe('invoice_already_paid');

    // 6. renewal 30 days later
    env.clock.advanceDays(30);
    env.provider.willSucceed();
    await env.runBilling(sub.id);
    await env.verify.expectSubscriptionIn(sub.id, 'active');

    // 7. customer cancels; a stray success webhook must not revive it
    const beforeCancel = await env.given.refresh(sub.id);
    await env.api.cancelSubscription(sub.id);
    const stray = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(beforeCancel).build());
    expect(stray.body.status).toBe('ignored');
    await env.verify.expectSubscriptionIn(sub.id, 'canceled');

    // 8. billing stops
    env.clock.advanceDays(30);
    expect((await env.runBilling(sub.id)).action).toBe('skipped');

    // --- final assertions ---
    expect(env.verify.transitionsOf(sub.id)).toEqual([
      'trialing->past_due', 'past_due->active', 'active->active', 'active->canceled',
    ]);
    expect(env.provider.callsFor(sub.id).map((c) => c.idempotencyKey)).toEqual([
      'inv_001:attempt-1', 'inv_001:attempt-2', 'inv_002:attempt-1',
    ]);
    const invoices = env.repos.invoices.findBySubscription(sub.id);
    expect(invoices.map((i) => [i.id, i.status, i.amount])).toEqual([
      ['inv_001', 'paid', 1900],
      ['inv_002', 'paid', 1900],
    ]);
    expect(env.notifier.for(sub.id).map((n) => n.kind)).toEqual([
      'subscription.past_due', 'subscription.active', 'subscription.canceled',
    ]);
    env.assertCleanTeardown();
  });
});
