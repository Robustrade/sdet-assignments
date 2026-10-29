import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';

/**
 * Recurring billing of an `active` subscription: one new invoice and one provider charge per
 * 30-day period, counted from the last payment. `basic` is used because it is `active` right after
 * creation (its first invoice, inv_001, is paid on 2026-01-01).
 */
describe('billing run: recurring charge of an active subscription', () => {
  let env: TestEnvironment;

  const RECURRING_CHARGE = (attempt: number) => ({
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: `attempt:sub_001:${attempt}`,
    reference: 'sub_001',
  });

  beforeEach(async () => {
    env = TestEnvironment.create();
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());
    expect(created.body).toMatchObject({ id: 'sub_001', status: 'active' });
    env.providerCalls.expectCallCount(1);
  });

  describe('when the period is not over yet', () => {
    it('does not charge one millisecond before 30 days have passed', async () => {
      env.clock.advanceDays(30);
      env.clock.advanceMs(-1);
      const before = await env.persistence.snapshot();

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(1);
      await env.persistence.expectUnchangedSince(before);
    });
  });

  describe('recurring charge succeeds (active stays active)', () => {
    beforeEach(() => {
      env.clock.advanceDays(30);
    });

    it('charges the plan price once, with a key that is new for this attempt', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(1, RECURRING_CHARGE(2));
      env.providerCalls.expectDistinctIdempotencyKeys();
    });

    it('writes a second paid invoice and no audit entry (active has no charge_succeeded arrow)', async () => {
      await env.runBilling();

      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'paid']);
      await env.persistence.expectInvoice('inv_002', {
        attempt: 2,
        amount: 1900,
        idempotencyKey: 'attempt:sub_001:2',
        providerChargeId: 'ch_mock_002',
        createdAt: '2026-01-31T00:00:00.000Z',
      });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('does not charge twice in the same period when the run is repeated', async () => {
      await env.runBilling();
      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(2);
      await env.persistence.expectInvoiceCount('sub_001', 2);
    });

    it('counts the next period from the latest payment: due again on day 60, not on day 59', async () => {
      await env.runBilling();

      env.clock.advanceDays(29);
      expect(await env.runBilling()).toEqual([]);
      env.providerCalls.expectCallCount(2);

      env.clock.advanceDays(1);
      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_003', attempt: 3, outcome: 'paid' },
      ]);
      env.providerCalls.expectChargeAt(2, RECURRING_CHARGE(3));
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'paid', 'paid']);
    });
  });

  describe('recurring charge is declined (active -> past_due)', () => {
    beforeEach(() => {
      env.provider.declineOnce('card_declined');
      env.clock.advanceDays(30);
    });

    it('moves to past_due, records the failed invoice and the scheduler transition', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'declined' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('past_due');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'failed']);
      await env.persistence.expectInvoice('inv_002', { declineCode: 'card_declined' });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
        { from: 'active', to: 'past_due', trigger: 'charge_failed', source: 'scheduler' },
      ]);
      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('keeps the earlier successful payment on record (no contradictory history)', async () => {
      await env.runBilling();

      await env.persistence.expectInvoice('inv_001', { status: 'paid', providerChargeId: 'ch_mock_001' });
    });
  });

  describe('recurring charge times out', () => {
    it('stays active with a pending invoice, then re-sends the identical request', async () => {
      env.provider.timeoutOnce();
      env.clock.advanceDays(30);

      const first = await env.runBilling();
      expect(first).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'timeout' }]);
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'pending']);

      const second = await env.runBilling();
      expect(second).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
      env.providerCalls.expectCallCount(3);
      env.providerCalls.expectChargeAt(1, RECURRING_CHARGE(2));
      env.providerCalls.expectChargeAt(2, RECURRING_CHARGE(2));
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'paid']);
    });
  });

  describe('cancellation stops future billing', () => {
    it('a canceled subscription is never charged again, however much time passes', async () => {
      await env.api.cancelSubscription('sub_001');
      env.clock.advanceDays(365);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(1); // the creation charge only
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
        { from: 'active', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
    });

    it('canceling after one recurring period ends billing at that point', async () => {
      env.clock.advanceDays(30);
      await env.runBilling();
      await env.api.cancelSubscription('sub_001');
      env.clock.advanceDays(90);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(2);
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'paid']);
    });
  });

  describe('a pro subscription after its trial', () => {
    it('is billed again 30 days after the trial-end payment, at the pro price', async () => {
      const pro = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').forCustomer('cust_002').build());
      expect(pro.body.id).toBe('sub_002');
      env.clock.advanceDays(14);
      await env.runBilling(); // trial-end charge for sub_002 (attempt 1)
      env.clock.advanceDays(30);

      const run = await env.runBilling();

      expect(run.filter((entry) => entry.subscriptionId === 'sub_002')).toEqual([
        { subscriptionId: 'sub_002', invoiceId: expect.any(String), attempt: 2, outcome: 'paid' },
      ]);
      const proCharges = env.provider.calls.filter((call) => call.reference === 'sub_002');
      expect(proCharges.map((call) => [call.amount, call.idempotencyKey])).toEqual([
        [4900, 'initial:sub_002'],
        [4900, 'attempt:sub_002:2'],
      ]);
    });
  });
});
