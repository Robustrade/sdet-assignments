import { aSignupRequest } from '../framework/builders';
import { BILLING_PERIOD_DAYS, PLANS } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

/** What gets written for each kind of event - and what must not be. */
describe('Persisted records per lifecycle stage', () => {
  const env = useHarness();

  it('trial signup writes one subscription and one audit entry, nothing billing-related', async () => {
    const dbBefore = env().snapshot();

    await env().given.trialing();

    expect(env().snapshot().rowDelta(dbBefore)).toEqual({ subscriptions: 1, audit_log: 1 });
  });

  it('each billing attempt writes exactly one attempt row; the invoice is reused across retries', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDue();
    env().gateway.willDecline();
    const dbBefore = env().snapshot();

    await env().billAtNextRetry(invoiceId);

    expect(env().snapshot().rowDelta(dbBefore)).toEqual({ charge_attempts: 1, audit_log: 1, notifications: 1 });
    expect(env().stored(subscriptionId).invoices).toHaveLength(1);
    expect(env().repos.invoices.findById(invoiceId)!.failedAttempts).toBe(2);
  });

  it('attempt rows carry the full story: number, key, amount, provider charge id, reason, timestamps', async () => {
    const { invoiceId } = await env().given.pastDue();
    env().gateway.willSucceed();

    await env().billAtNextRetry(invoiceId);

    const [declined, succeeded] = env().repos.attempts.findByInvoice(invoiceId);
    const price = PLANS.pro.priceCents;
    expect(declined).toMatchObject({ attemptNo: 1, status: 'declined', failureReason: 'insufficient_funds', amountCents: price });
    expect(succeeded).toMatchObject({ attemptNo: 2, status: 'succeeded', failureReason: null, amountCents: price });
    expect(declined!.providerChargeId).toMatch(/^ch_/);
    expect(succeeded!.providerChargeId).toMatch(/^ch_/);
    expect(declined!.settledAt! <= succeeded!.createdAt).toBe(true);
    expect(env().repos.invoices.findById(invoiceId)!.paidAt).toBe(succeeded!.settledAt);
  });

  it('timestamps are coherent: created <= trial end <= period start < period end, canceled_at after creation', async () => {
    const created = await env().api.createOk(aSignupRequest().onBasicPlan().build());
    await env().advanceDaysAndBill(PLANS.basic.trialDays);
    env().clock.advanceDays(2);
    await env().api.cancel(created.id);

    const subscription = env().stored(created.id).subscription;
    const ms = (iso: string | null) => Date.parse(iso!);
    expect(ms(subscription.createdAt)).toBeLessThanOrEqual(ms(subscription.trialEndsAt));
    expect(ms(subscription.trialEndsAt)).toBeLessThanOrEqual(ms(subscription.currentPeriodStart));
    expect(ms(subscription.currentPeriodStart)).toBeLessThan(ms(subscription.currentPeriodEnd));
    expect(ms(subscription.canceledAt)).toBeGreaterThan(ms(subscription.createdAt));
    expect(ms(subscription.updatedAt)).toBe(ms(subscription.canceledAt));
  });

  it('webhook events are logged with their outcome, including ones that were ignored', async () => {
    const { subscriptionId, invoiceId } = await env().given.active();
    const staleFailure = env().webhooks.about(invoiceId).paymentFailed().build();

    await env().webhooks.send(staleFailure);

    const [logged] = env().stored(subscriptionId).webhookEvents;
    expect(logged).toMatchObject({ eventId: staleFailure.event_id, type: 'payment.failed', outcome: 'ignored', reason: 'invoice_paid' });
    expect(JSON.parse(logged!.payload)).toEqual(staleFailure);
  });

  it('refund marks the invoice refunded and is audited, without touching the subscription status', async () => {
    const { subscriptionId, invoiceId } = await env().given.active();

    await env().webhooks.send(env().webhooks.about(invoiceId).paymentRefunded());

    const stored = env().stored(subscriptionId);
    expect(stored.latestInvoice?.status).toBe('refunded');
    expect(stored.status).toBe('active');
    expect(stored.auditActions().at(-1)).toBe('invoice_refunded');
    expect(stored.notificationKinds()).toContain('refund_issued');
  });

  it('customer cancel voids the open invoice so nothing is collected afterwards', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();

    await env().api.cancel(subscriptionId);
    const callsAtCancel = env().gateway.callCount();
    await env().advanceDaysAndBill(BILLING_PERIOD_DAYS);

    expect(env().repos.invoices.findById(invoiceId)?.status).toBe('void');
    expect(env().gateway.callsSince(callsAtCancel)).toEqual([]);
  });
});
