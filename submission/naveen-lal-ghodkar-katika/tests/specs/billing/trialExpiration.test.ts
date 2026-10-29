import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';

/**
 * Trial expiration: a `pro` subscription (14-day trial) is charged by the billing run once the clock
 * passes `trial_ends_at`, and not before. The clock, ids and provider outcomes are all deterministic.
 */
describe('billing run: trial expiration', () => {
  let env: TestEnvironment;

  /** What the first (trial-end) charge of the default request must look like at the provider. */
  const TRIAL_END_CHARGE = {
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
    amount: 4900,
    currency: 'USD',
    idempotencyKey: 'initial:sub_001',
    reference: 'sub_001',
  };

  beforeEach(async () => {
    env = TestEnvironment.create();
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    expect(created.body).toMatchObject({ id: 'sub_001', status: 'trialing', trial_ends_at: '2026-01-15T00:00:00.000Z' });
    env.providerCalls.expectNoCharges(); // a trialing subscription costs nothing yet
  });

  describe('before the trial ends', () => {
    it('does not charge, create invoices or change state', async () => {
      env.clock.advanceDays(13);
      const before = await env.persistence.snapshot();

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectNoCharges();
      await env.persistence.expectUnchangedSince(before);
      await env.persistence.expectStoredStatus('sub_001', 'trialing');
    });

    it('does not charge one millisecond before trial_ends_at', async () => {
      env.clock.advanceDays(14);
      env.clock.advanceMs(-1);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectNoCharges();
    });

    it('charges at exactly trial_ends_at', async () => {
      env.clock.advanceDays(14);

      expect(await env.runBilling()).toHaveLength(1);

      env.providerCalls.expectCallCount(1);
    });
  });

  describe('trial ends, first charge succeeds (trialing -> active)', () => {
    beforeEach(async () => {
      env.clock.advanceDays(14);
    });

    it('charges the plan price once with the stored customer and payment method', async () => {
      await env.runBilling();

      env.providerCalls.expectChargedOnce(TRIAL_END_CHARGE);
    });

    it('activates the subscription and reports the charge in the run result', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'paid' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('active');
      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('persists one paid invoice that carries the provider charge id and the attempt key', async () => {
      await env.runBilling();

      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectInvoice('inv_001', {
        subscriptionId: 'sub_001',
        amount: 4900,
        currency: 'USD',
        attempt: 1,
        idempotencyKey: 'initial:sub_001',
        providerChargeId: 'ch_mock_001',
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z',
      });
    });

    it('records the transition in the audit log as a scheduler-driven change', async () => {
      await env.runBilling();

      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
      await env.persistence.expectAuditEntryAt('sub_001', 0, '2026-01-15T00:00:00.000Z');
    });

    it('does not charge again when the billing run is repeated', async () => {
      await env.runBilling();
      expect(await env.runBilling()).toEqual([]);
      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(1);
      await env.persistence.expectInvoiceCount('sub_001', 1);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      ]);
    });

    it('also charges when the run happens long after the trial ended (a missed run is caught up)', async () => {
      env.clock.advanceDays(5);

      await env.runBilling();

      env.providerCalls.expectChargedOnce(TRIAL_END_CHARGE);
      await env.persistence.expectStoredStatus('sub_001', 'active');
    });
  });

  describe('trial ends, first charge is declined (trialing -> past_due)', () => {
    beforeEach(async () => {
      env.provider.willDecline('insufficient_funds');
      env.clock.advanceDays(14);
    });

    it('moves to past_due, not active or canceled, and records the failure', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'declined' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('past_due');
      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
      await env.persistence.expectInvoice('inv_001', { declineCode: 'insufficient_funds', amount: 4900 });
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'scheduler' },
      ]);
      await env.persistence.expectCoherent('sub_001', res.body);
      env.providerCalls.expectChargedOnce(TRIAL_END_CHARGE);
    });

    it('does not create a paid record for a declined charge', async () => {
      await env.runBilling();

      await env.persistence.expectInvoiceWithoutProviderCharge('inv_001');
    });
  });

  describe('trial ends, provider times out (outcome unknown)', () => {
    beforeEach(async () => {
      env.provider.timeoutOnce();
      env.clock.advanceDays(14);
    });

    it('leaves the subscription trialing with a pending invoice and no audit entry', async () => {
      const run = await env.runBilling();

      expect(run).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'timeout' }]);
      const res = await env.api.getSubscription('sub_001');
      expect(res.body.status).toBe('trialing');
      await env.persistence.expectInvoiceStatuses('sub_001', ['pending']);
      await env.persistence.expectNoAuditEntries('sub_001');
      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('re-sends the identical request on the next run, on the same invoice, and then activates', async () => {
      await env.runBilling();
      const second = await env.runBilling();

      expect(second).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'paid' }]);
      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(0, TRIAL_END_CHARGE);
      env.providerCalls.expectChargeAt(1, TRIAL_END_CHARGE); // same idempotency key: the provider can deduplicate
      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']); // still one invoice
      await env.persistence.expectStoredStatus('sub_001', 'active');
    });

    it('a timeout followed by a decline ends in past_due with a single failed invoice', async () => {
      env.provider.declineOnce('do_not_honor');

      await env.runBilling();
      await env.runBilling();

      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
      await env.persistence.expectStoredStatus('sub_001', 'past_due');
    });
  });

  describe('unexpected provider failure', () => {
    it('propagates, keeps the invoice pending and state unchanged, and the next run recovers', async () => {
      env.clock.advanceDays(14);
      env.provider.charge.mockRejectedValueOnce(new Error('provider exploded'));

      await expect(env.runBilling()).rejects.toThrow('provider exploded');

      await env.persistence.expectStoredStatus('sub_001', 'trialing');
      await env.persistence.expectInvoiceStatuses('sub_001', ['pending']);

      expect(await env.runBilling()).toEqual([
        { subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'paid' },
      ]);
      env.providerCalls.expectChargeAt(1, TRIAL_END_CHARGE);
    });
  });

  describe('cancellation protection', () => {
    it('a subscription canceled during the trial is never charged', async () => {
      await env.api.cancelSubscription('sub_001');
      env.clock.advanceDays(60);

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectNoCharges();
      await env.persistence.expectNoInvoices();
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
    });

    it('canceling after a timed-out trial-end charge stops any further attempt on that invoice', async () => {
      env.provider.timeoutOnce();
      env.clock.advanceDays(14);
      await env.runBilling();
      await env.api.cancelSubscription('sub_001');

      expect(await env.runBilling()).toEqual([]);

      env.providerCalls.expectCallCount(1); // only the attempt made before the cancel
      await env.persistence.expectStoredStatus('sub_001', 'canceled');
    });
  });

  describe('plan-specific trial rules', () => {
    it('a basic subscription (0-day trial) is charged at creation, not again by the trial-end run', async () => {
      const basic = await env.api.createSubscription(
        aSubscriptionRequest().onPlan('basic').forCustomer('cust_002').build(),
      );
      expect(basic.body).toMatchObject({ id: 'sub_002', status: 'active', price: 1900 });
      env.providerCalls.expectCallCount(1);

      env.clock.advanceDays(14); // the pro trial ends; the basic one has nothing due yet
      const run = await env.runBilling();

      expect(run.map((entry) => entry.subscriptionId)).toEqual(['sub_001']);
      env.providerCalls.expectCallCount(2);
      env.providerCalls.expectChargeAt(0, {
        customerId: 'cust_002',
        paymentMethodId: 'pm_test_visa_4242',
        amount: 1900,
        currency: 'USD',
        idempotencyKey: 'initial:sub_002',
        reference: 'sub_002',
      });
      env.providerCalls.expectChargeAt(1, TRIAL_END_CHARGE);
    });

    it('only charges the subscriptions whose own trial has ended', async () => {
      env.clock.advanceDays(7);
      await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').forCustomer('cust_002').build());
      env.clock.advanceDays(7); // day 14: sub_001's trial is over, sub_002's ends on day 21

      const run = await env.runBilling();

      expect(run.map((entry) => entry.subscriptionId)).toEqual(['sub_001']);
      await env.persistence.expectStoredStatus('sub_001', 'active');
      await env.persistence.expectStoredStatus('sub_002', 'trialing');
      await env.persistence.expectInvoiceCount('sub_002', 0);
    });
  });
});
