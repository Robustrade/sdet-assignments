import { TestEnvironment } from '../../support/TestEnvironment';
import { aSubscriptionRequest } from '../../support/builders/SubscriptionRequestBuilder';
import { paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

describe('Payment provider interaction (mocked external dependency)', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => env.assertCleanTeardown());

  it('pro signup: exactly one charge with the exact amount, customer, payment method and idempotency key', async () => {
    const customer = env.given.customer();
    env.provider.willSucceed();

    const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    const invoiceId = res.body.latest_invoice!.id;

    expect(env.provider.calls).toEqual([
      {
        amount: 4900,
        currency: 'USD',
        customerId: customer.id,
        paymentMethodId: 'pm_test_visa_4242',
        subscriptionId: res.body.id,
        invoiceId,
        idempotencyKey: `${invoiceId}:attempt-1`,
      },
    ]);
  });

  it('basic signup (trial) makes no charge; trial end charges the basic price once', async () => {
    const sub = await env.given.trialingSubscription();
    expect(env.provider.callCount).toBe(0);

    env.clock.advanceDays(14);
    env.provider.willSucceed();
    await env.runBilling(sub.id);

    expect(env.provider.callsFor(sub.id)).toEqual([expect.objectContaining({ amount: 1900, currency: 'USD' })]);
  });

  it('retry of the SAME invoice uses a NEW idempotency key per attempt', async () => {
    const sub = await env.given.pastDueSubscription();
    env.provider.willSucceed();
    await env.runBilling(sub.id);

    const [first, retry] = env.provider.callsFor(sub.id);
    expect(retry.invoiceId).toBe(first.invoiceId);
    expect([first.idempotencyKey, retry.idempotencyKey]).toEqual([
      `${first.invoiceId}:attempt-1`, `${first.invoiceId}:attempt-2`,
    ]);
    expect(env.repos.invoices.findById(first.invoiceId)).toMatchObject({ status: 'paid', attemptCount: 2 });
  });

  it('renewal charges the same plan price as signup (price consistency)', async () => {
    const sub = await env.given.activeSubscription('pro');
    env.clock.advanceDays(30);
    env.provider.willSucceed();
    await env.runBilling(sub.id);

    const amounts = env.provider.callsFor(sub.id).map((c) => c.amount);
    expect(amounts).toEqual([4900, 4900]);
    expect(new Set(env.provider.callsFor(sub.id).map((c) => c.invoiceId)).size).toBe(2);
    await env.verify.expectSubscriptionIn(sub.id, 'active');
  });

  it('renewal is not charged before the period ends', async () => {
    const sub = await env.given.activeSubscription('pro');
    env.clock.advanceDays(29);
    expect(await env.runBilling(sub.id)).toEqual({ action: 'skipped', reason: 'period_not_ended' });
    expect(env.provider.callCount).toBe(1);
  });

  describe('mock outcome: DECLINE', () => {
    it('pro signup declined -> 201 past_due, failed invoice + failed payment, NO success record', async () => {
      env.provider.willDecline('insufficient_funds');
      const res = await env.api.createSubscription(aSubscriptionRequest().forCustomer(env.given.customer()).onPlan('pro').build());

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('past_due');
      const snap = env.verify.snapshot(res.body.id);
      expect(snap.invoices).toEqual([expect.objectContaining({ status: 'failed', paidAt: null, attemptCount: 1 })]);
      expect(snap.payments).toEqual([
        expect.objectContaining({ status: 'failed', failureReason: 'insufficient_funds', providerReference: null }),
      ]);
      await env.verify.expectSubscriptionIn(res.body.id, 'past_due');
    });
  });

  describe('mock outcome: TIMEOUT (outcome unknown)', () => {
    it('does not transition, records a pending attempt, and waits for the webhook', async () => {
      const sub = await env.given.trialWithPendingCharge();

      const snap = env.verify.snapshot(sub.id);
      expect(snap.subscription.status).toBe('trialing');
      expect(snap.invoices).toEqual([expect.objectContaining({ status: 'open', attemptCount: 1 })]);
      expect(snap.payments).toEqual([expect.objectContaining({ status: 'pending', failureReason: 'provider_timeout' })]);
      expect(snap.audit.map((a) => a.action)).toContain('payment.outcome_unknown');
    });

    it('never re-charges while an attempt is unresolved (prevents double charge)', async () => {
      const sub = await env.given.trialWithPendingCharge();
      expect(await env.runBilling(sub.id)).toEqual({ action: 'skipped', reason: 'charge_outcome_pending' });
      expect(await env.runBilling(sub.id)).toEqual({ action: 'skipped', reason: 'charge_outcome_pending' });
      expect(env.provider.callsFor(sub.id)).toHaveLength(1);
    });

    it('webhook resolves the pending attempt in place (no second payment row)', async () => {
      const sub = await env.given.trialWithPendingCharge();
      const pendingId = env.repos.payments.findBySubscription(sub.id)[0].id;

      await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());

      expect(env.repos.payments.findBySubscription(sub.id)).toEqual([
        expect.objectContaining({ id: pendingId, status: 'succeeded', failureReason: null }),
      ]);
      await env.verify.expectSubscriptionIn(sub.id, 'active');
    });
  });

  it('no provider call for rejected creation, cancellation, or GET', async () => {
    const sub = await env.given.trialingSubscription();
    await env.api.createSubscription(aSubscriptionRequest().onPlan('nope').build());
    await env.api.getSubscription(sub.id);
    await env.api.cancelSubscription(sub.id);
    expect(env.provider.callCount).toBe(0);
  });
});
