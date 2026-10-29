import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';

/**
 * Retries of a `past_due` subscription: one new attempt per day, a success returns it to `active`,
 * the third consecutive failed invoice cancels it. A `basic` subscription whose creation charge is
 * declined is the starting point (past_due, one failed invoice, 2026-01-01).
 */
describe('billing run: payment retries of a past_due subscription', () => {
  let env: TestEnvironment;

  const RETRY_CHARGE = (attempt: number) => ({
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: `attempt:sub_001:${attempt}`,
    reference: 'sub_001',
  });

  beforeEach(async () => {
    env = TestEnvironment.create();
    env.provider.declineOnce('insufficient_funds');
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());
    expect(created.body).toMatchObject({ id: 'sub_001', status: 'past_due' });
    await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
  });

  describe('timing', () => {
    it('does not retry before the 1-day interval has passed', async () => {
      env.clock.advanceDays(1);
      env.clock.advanceMs(-1);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(1);
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
    });

    it('retries exactly one day after the failure', async () => {
      env.clock.advanceDays(1);

      expect(await env.runBilling()).toHaveLength(1);

      env.providerCalls.expectCallCount(2);
    });
  });

  describe('retry succeeds (past_due -> active)', () => {
    beforeEach(() => {
      env.clock.advanceDays(1);
    });

    it('reactivates the subscription, charging the same price with a new attempt key', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('active');
      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(1, RETRY_CHARGE(2));
      env.providerCalls.expectDistinctIdempotencyKeys();
      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('keeps the failed attempt and adds a paid one, with a coherent audit history', async () => {
      await env.runBilling();

      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'paid']);
      await env.persistence.expectInvoice('inv_001', { status: 'failed', declineCode: 'insufficient_funds' });
      await env.persistence.expectInvoice('inv_002', { status: 'paid', providerChargeId: 'ch_mock_001' });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
        { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
    });

    it('does not retry again once active (repeated run is a no-op)', async () => {
      await env.runBilling();
      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(2);
      await env.persistence.expectInvoiceCount('sub_001', 2);
    });
  });

  describe('retry fails again', () => {
    it('keeps past_due without a transition or audit entry, and records another failed invoice', async () => {
      env.provider.willDecline('card_declined');
      env.clock.advanceDays(1);

      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'declined' }]);
      await env.persistence.expectStoredStatus('sub_001', 'past_due');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });
  });

  describe('retries exhausted (past_due -> canceled)', () => {
    beforeEach(async () => {
      env.provider.willDecline('card_declined');
      env.clock.advanceDays(1);
      await env.runBilling(); // attempt 2: still past_due
    });

    it('stays past_due after two failures and cancels on the third', async () => {
      await env.persistence.expectStoredStatus('sub_001', 'past_due');

      env.clock.advanceDays(1);
      const run = await env.runBilling(); // attempt 3

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_003', attempt: 3, outcome: 'declined' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed', 'failed']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
        { from: 'past_due', to: 'canceled', trigger: 'retries_exhausted', source: 'scheduler' },
      ]);
      await env.persistence.expectCoherent('sub_001', res.body);
      env.providerCalls.expectCallCount(3);
    });

    it('never charges again after the cancellation, however long we wait', async () => {
      env.clock.advanceDays(1);
      await env.runBilling();
      env.clock.advanceDays(365);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(3);
      await env.persistence.expectInvoiceCount('sub_001', 3);
    });

    it('cannot be revived by a stray payment.succeeded webhook afterwards', async () => {
      env.clock.advanceDays(1);
      await env.runBilling();
      const late = aWebhookEvent().succeeded().withId('evt_late').forSubscription('sub_001').forInvoice('inv_003').withAmount(1900);

      BillingAssertions.expectWebhookAck(await env.webhooks.deliver(late.build()), 'ignored');

      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed', 'failed']);
      await env.persistence.expectWebhookEvent('evt_late', { outcome: 'ignored', reason: 'subscription_canceled' });
    });
  });

  describe('a payment resets the failure count', () => {
    it('after a successful retry, three more consecutive failures are needed to cancel', async () => {
      // day 1: retry declines (past_due), day 2: retry succeeds (active)
      env.provider.declineOnce('card_declined').succeedOnce();
      env.clock.advanceDays(1);
      await env.runBilling();
      env.clock.advanceDays(1);
      await env.runBilling();
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'failed', 'paid']);

      // 30 days after the payment the recurring charge fails; then two retries fail.
      env.provider.willDecline('card_declined');
      env.clock.advanceDays(30);
      await env.runBilling();
      await env.persistence.expectStoredStatus('sub_001', 'past_due');
      env.clock.advanceDays(1);
      await env.runBilling();
      await env.persistence.expectStoredStatus('sub_001', 'past_due'); // 5 failures overall, only 2 in a row

      env.clock.advanceDays(1);
      await env.runBilling();

      await env.persistence.expectStoredStatus('sub_001', 'canceled');
      await env.persistence.expectInvoiceStatuses('sub_001', [
        'failed',
        'failed',
        'paid',
        'failed',
        'failed',
        'failed',
      ]);
      await env.persistence.expectCoherent('sub_001', (await env.api.getSubscription('sub_001')).body);
    });
  });

  describe('retry times out (outcome unknown)', () => {
    it('does not count a timeout as a failure: any number of timeouts keeps it past_due, then success reactivates', async () => {
      env.clock.advanceDays(1);
      env.provider.timeoutOnce().timeoutOnce().timeoutOnce();

      for (let run = 0; run < 3; run += 1) {
        const result = await env.runBilling();
        expect(result).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'timeout' }]);
        await env.persistence.expectStoredStatus('sub_001', 'past_due');
      }
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'pending']);

      const resolved = await env.runBilling();

      expect(resolved).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'paid']);
      env.providerCalls.expectCallCount(5); // creation + 3 timeouts + the resolving call
      for (const index of [1, 2, 3, 4]) {
        env.providerCalls.expectChargeAt(index, RETRY_CHARGE(2)); // same attempt, same idempotency key
      }
    });
  });

  describe('API cancel while past_due', () => {
    // The lifecycle has no past_due -> canceled arrow for `cancel` (only `retries_exhausted`), so the
    // request is rejected and billing must carry on exactly as if it had never been sent.
    it('is rejected with 409 and does not interrupt the retries', async () => {
      BillingAssertions.expectError(await env.api.cancelSubscription('sub_001'), 409, 'invalid_transition');
      env.clock.advanceDays(1);

      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' },
      ]);

      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
        { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
    });
  });
});
