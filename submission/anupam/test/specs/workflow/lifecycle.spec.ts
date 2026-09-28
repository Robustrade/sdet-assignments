import { TestEnvironment } from '../../support/TestEnvironment';
import { paymentFailed, paymentSucceeded } from '../../support/builders/WebhookEventBuilder';

/**
 * State-machine behaviour through the REAL entry points (API, billing run, webhooks).
 * A coverage tracker reads the audit log after every test and, in afterAll,
 * proves every transition from the assignment diagram was exercised.
 */
const REQUIRED = [
  'trialing->active',
  'trialing->past_due',
  'active->past_due',
  'past_due->active',
  'past_due->canceled',
  'active->canceled',
  'trialing->canceled',
];
const observed = new Set<string>();

describe('Subscription lifecycle (state machine via API + billing + webhooks)', () => {
  let env: TestEnvironment;
  beforeEach(() => { env = TestEnvironment.create(); });
  afterEach(() => {
    env.repos.subscriptions.all().forEach((s) => env.verify.transitionsOf(s.id).forEach((t) => observed.add(t)));
    env.assertCleanTeardown();
  });
  afterAll(() => {
    expect(REQUIRED.filter((t) => !observed.has(t))).toEqual([]);
  });

  describe('valid transitions', () => {
    it('trialing -> active: trial ends and first charge succeeds (provider response)', async () => {
      const sub = await env.given.trialingSubscription();
      env.clock.advanceDays(14);
      env.provider.willSucceed();

      await env.runBilling(sub.id);

      await env.verify.expectSubscriptionIn(sub.id, 'active');
      expect(env.verify.transitionsOf(sub.id)).toEqual(['trialing->active']);
    });

    it('trialing -> active: pending first charge confirmed by payment.succeeded webhook', async () => {
      const sub = await env.given.trialWithPendingCharge();
      await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());
      await env.verify.expectSubscriptionIn(sub.id, 'active');
    });

    it('trialing -> past_due: first charge declined', async () => {
      const sub = await env.given.trialingSubscription();
      env.clock.advanceDays(14);
      env.provider.willDecline('insufficient_funds');
      await env.runBilling(sub.id);
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
    });

    it('trialing -> past_due: pending first charge reported failed by webhook', async () => {
      const sub = await env.given.trialWithPendingCharge();
      await env.webhooks.deliver(paymentFailed().forLatestInvoiceOf(sub).withFailureReason('expired_card').build());
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
      expect(env.repos.payments.findBySubscription(sub.id)).toEqual([
        expect.objectContaining({ status: 'failed', failureReason: 'expired_card' }),
      ]);
    });

    it('active -> past_due: recurring charge declined', async () => {
      const sub = await env.given.activeSubscription('pro');
      env.clock.advanceDays(30);
      env.provider.willDecline();
      await env.runBilling(sub.id);
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
    });

    it('active -> past_due: pending renewal reported failed by webhook', async () => {
      const sub = await env.given.activeWithPendingRenewal();
      await env.webhooks.deliver(paymentFailed().forLatestInvoiceOf(sub).build());
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
    });

    it('past_due -> active: retry succeeds, dunning counter resets', async () => {
      const sub = await env.given.pastDueSubscription();
      env.provider.willSucceed();
      await env.runBilling(sub.id);
      await env.verify.expectSubscriptionIn(sub.id, 'active');
      expect(env.repos.subscriptions.getById(sub.id).failedAttempts).toBe(0);
    });

    it('past_due -> canceled: basic plan exhausts its 2 retries', async () => {
      const sub = await env.given.pastDueSubscription(); // failure #1
      env.provider.willDecline('card_declined', 2);
      await env.runBilling(sub.id); // retry 1
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
      await env.runBilling(sub.id); // retry 2 -> exhausted
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
      expect(env.verify.transitionsOf(sub.id)).toEqual([
        'trialing->past_due', 'past_due->past_due', 'past_due->canceled',
      ]);
    });

    it('plan-specific: pro plan gets 3 retries (basic only 2) before canceling', async () => {
      const sub = await env.given.activeSubscription('pro');
      env.clock.advanceDays(30);
      env.provider.willDecline('card_declined', 3);
      await env.runBilling(sub.id); // initial renewal failure -> past_due
      await env.runBilling(sub.id); // retry 1
      await env.runBilling(sub.id); // retry 2 (basic would already be canceled here)
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
      env.provider.willDecline();
      await env.runBilling(sub.id); // retry 3 -> exhausted
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
    });

    it('active -> canceled via API', async () => {
      const sub = await env.given.activeSubscription('pro');
      const res = await env.api.cancelSubscription(sub.id);
      expect(res.status).toBe(200);
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
    });

    it('trialing -> canceled via API', async () => {
      const sub = await env.given.trialingSubscription();
      await env.api.cancelSubscription(sub.id);
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
    });
  });

  describe('invalid transitions are impossible', () => {
    it('canceled -> active: a stray payment.succeeded webhook does NOT reactivate', async () => {
      const sub = await env.given.trialWithPendingCharge();
      await env.api.cancelSubscription(sub.id);

      const res = await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());

      expect(res.body).toMatchObject({ status: 'ignored', reason: 'subscription_canceled' });
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
      expect(env.repos.payments.findBySubscription(sub.id).some((p) => p.status === 'succeeded')).toBe(false);
    });

    it('canceled -> past_due: a stray payment.failed webhook is ignored', async () => {
      const sub = await env.given.trialWithPendingCharge();
      await env.api.cancelSubscription(sub.id);
      await env.webhooks.deliver(paymentFailed().forLatestInvoiceOf(sub).build());
      await env.verify.expectSubscriptionIn(sub.id, 'canceled');
    });

    it('past_due -> canceled via API is rejected (not in the diagram)', async () => {
      const sub = await env.given.pastDueSubscription();
      const res = await env.api.cancelSubscription(sub.id);
      expect(res.status).toBe(409);
      await env.verify.expectSubscriptionIn(sub.id, 'past_due');
    });

    it('out-of-order: payment.failed after payment.succeeded for the same invoice does not regress active', async () => {
      const sub = await env.given.trialWithPendingCharge();
      await env.webhooks.deliver(paymentSucceeded().forLatestInvoiceOf(sub).build());
      const res = await env.webhooks.deliver(paymentFailed().forLatestInvoiceOf(sub).build());

      expect(res.body).toMatchObject({ status: 'ignored', reason: 'invoice_already_paid' });
      await env.verify.expectSubscriptionIn(sub.id, 'active');
      expect(env.repos.payments.findBySubscription(sub.id).map((p) => p.status)).toEqual(['succeeded']);
    });

    it('trialing is not charged before the trial ends', async () => {
      const sub = await env.given.trialingSubscription();
      env.clock.advanceDays(13);
      expect(await env.runBilling(sub.id)).toEqual({ action: 'skipped', reason: 'trial_not_ended' });
      expect(env.provider.callCount).toBe(0);
      await env.verify.expectSubscriptionIn(sub.id, 'trialing');
    });

    it('canceled subscription is never billed again (cancellation stops future billing)', async () => {
      const sub = await env.given.canceledSubscription();
      const callsBefore = env.provider.callCount;
      env.clock.advanceDays(60);
      expect(await env.runBilling(sub.id)).toEqual({ action: 'skipped', reason: 'subscription_canceled' });
      expect(env.provider.callCount).toBe(callsBefore);
    });
  });
});
