import { aSignupRequest } from '../framework/builders';
import { BILLING_PERIOD_DAYS, daysAfterStart, PLANS, SEED } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

describe('Payment provider interaction', () => {
  const env = useHarness();

  describe('what is sent', () => {
    it('signup charge: exact customer, payment method, amount, currency, invoice reference and idempotency key', async () => {
      const created = await env().api.createOk(aSignupRequest().onProPlan().forCustomer(SEED.bob.customerId, SEED.bob.card).build());
      const invoiceId = env().latestInvoiceId(created.id);

      expect(env().gateway.calls).toEqual([
        {
          customerId: SEED.bob.customerId,
          paymentMethodId: SEED.bob.card,
          amountCents: PLANS.pro.priceCents,
          currency: 'USD',
          invoiceId,
          idempotencyKey: `${invoiceId}:attempt-1`,
        },
      ]);
    });

    it('trial-end charge uses the plan price captured at signup and the trial invoice reference', async () => {
      const { subscriptionId } = await env().given.trialing();

      await env().advanceDaysAndBill(PLANS.basic.trialDays);

      const invoiceId = env().latestInvoiceId(subscriptionId);
      expect(env().gateway.calls).toEqual([
        expect.objectContaining({ amountCents: PLANS.basic.priceCents, invoiceId, idempotencyKey: `${invoiceId}:attempt-1` }),
      ]);
    });

    it('each retry after a decline is a new attempt with a new idempotency key', async () => {
      const { invoiceId } = await env().given.pastDue();
      env().gateway.willDecline().willSucceed();

      await env().billAtNextRetry(invoiceId);
      await env().billAtNextRetry(invoiceId);

      expect(env().gateway.callsForInvoice(invoiceId).map((call) => call.idempotencyKey)).toEqual([
        `${invoiceId}:attempt-1`,
        `${invoiceId}:attempt-2`,
        `${invoiceId}:attempt-3`,
      ]);
    });
  });

  describe('how often', () => {
    it('exactly once per real billing attempt across a whole lifecycle', async () => {
      const { subscriptionId } = await env().given.trialing();
      env().gateway.willDecline().willDecline().willSucceed();

      await env().advanceDaysAndBill(PLANS.basic.trialDays); // attempt 1: declined
      const invoiceId = env().latestInvoiceId(subscriptionId);
      await env().billAtNextRetry(invoiceId); // attempt 2: declined
      await env().billAtNextRetry(invoiceId); // attempt 3: paid

      expect(env().gateway.calls).toHaveLength(3);
      expect(env().stored(subscriptionId).attempts).toHaveLength(3);
    });

    it('no provider call for actions that do not bill: trial signup, cancel, read, webhooks, replays, billing after cancel', async () => {
      const { subscriptionId: trialId } = await env().given.trialing();
      const { subscriptionId: paidId, invoiceId } = await env().given.active();
      const callsBefore = env().gateway.callCount();

      await env().api.get(trialId);
      await env().api.cancel(trialId);
      const lateWebhook = env().webhooks.about(invoiceId).paymentFailed().build();
      await env().webhooks.send(lateWebhook);
      await env().webhooks.send(lateWebhook); // replay
      await env().api.cancel(paidId);
      await env().advanceDaysAndBill(2 * BILLING_PERIOD_DAYS); // both canceled: nothing may be billed

      expect(env().gateway.callsSince(callsBefore)).toEqual([]);
    });
  });

  describe('outcomes', () => {
    it('decline: past_due, failure recorded with reason, no success record, retry scheduled', async () => {
      env().gateway.willDecline('insufficient_funds');

      const created = await env().api.createOk(aSignupRequest().onProPlan().build());

      const stored = env().stored(created.id);
      expect(created.status).toBe('past_due');
      expect(stored.attempts).toEqual([expect.objectContaining({ status: 'declined', failureReason: 'insufficient_funds' })]);
      expect(stored.latestInvoice).toMatchObject({ status: 'open', failedAttempts: 1, nextRetryAt: daysAfterStart(1) });
      expect(stored.auditActions()).toContain('payment_failed');
      expect(stored.notificationKinds()).toEqual(['payment_failed']);
    });

    it('timeout: no state change, attempt left unknown (not failed), no retry budget spent', async () => {
      env().gateway.willTimeout();

      const created = await env().api.createOk(aSignupRequest().onProPlan().build());

      const stored = env().stored(created.id);
      expect(created.status).toBe('trialing');
      expect(stored.attempts).toEqual([expect.objectContaining({ status: 'unknown', providerChargeId: null })]);
      expect(stored.latestInvoice).toMatchObject({ status: 'open', failedAttempts: 0 });
      expect(stored.auditActions()).toContain('charge_timed_out');
      expect(stored.notifications).toHaveLength(0);
    });

    it('timeout then the next billing run re-sends the SAME idempotency key', async () => {
      env().gateway.willTimeout().willSucceed();
      const created = await env().api.createOk(aSignupRequest().onProPlan().build());

      await env().runBilling();

      expect(env().gateway.calls).toHaveLength(2);
      expect(env().gateway.distinctIdempotencyKeys()).toHaveLength(1);
      expect(env().stored(created.id).status).toBe('active');
      expect(env().stored(created.id).attempts).toHaveLength(1);
    });
  });
});
