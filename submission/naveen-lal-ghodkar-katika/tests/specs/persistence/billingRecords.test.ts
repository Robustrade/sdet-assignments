import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aSubscriptionRecord } from '../../framework/builders/SubscriptionRecordBuilder';

/**
 * What the API-driven paths (create, cancel) must leave in the invoice, audit and subscription stores.
 * Webhook-driven persistence lives in specs/webhooks.
 */
describe('persistence written by POST /subscriptions and POST /subscriptions/{id}/cancel', () => {
  let env: TestEnvironment;

  const basicRequest = () =>
    aSubscriptionRequest().forCustomer('cust_002').onPlan('basic').withPaymentMethod('pm_test_mastercard_5555').build();
  const proRequest = () => aSubscriptionRequest().onPlan('pro').build();

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  describe('basic plan, provider approves', () => {
    it('writes one paid invoice that records the provider charge and the plan price', async () => {
      await env.api.createSubscription(basicRequest());

      await env.persistence.expectInvoiceCount('sub_001', 1);
      await env.persistence.expectInvoice('inv_001', {
        subscriptionId: 'sub_001',
        amount: 1900,
        currency: 'USD',
        status: 'paid',
        attempt: 1,
        idempotencyKey: 'initial:sub_001',
        providerChargeId: 'ch_mock_001',
      });
    });

    it('records trialing -> active in the audit log as an API-sourced charge_succeeded', async () => {
      await env.api.createSubscription(basicRequest());

      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      ]);
    });

    it('keeps subscription, invoice and audit coherent with the API response', async () => {
      const res = await env.api.createSubscription(basicRequest());

      await env.persistence.expectCoherent('sub_001', res.body);
    });

    it('records no webhook event (no webhook was involved)', async () => {
      await env.api.createSubscription(basicRequest());

      await env.persistence.expectNoWebhookEvents();
    });
  });

  describe('basic plan, provider declines', () => {
    beforeEach(() => {
      env.provider.willDecline('insufficient_funds');
    });

    it('writes a failed invoice with the decline code and no paid record', async () => {
      await env.api.createSubscription(basicRequest());

      await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);
      await env.persistence.expectInvoice('inv_001', {
        amount: 1900,
        attempt: 1,
        idempotencyKey: 'initial:sub_001',
        declineCode: 'insufficient_funds',
      });
    });

    it('records trialing -> past_due in the audit log and stays coherent', async () => {
      const res = await env.api.createSubscription(basicRequest());

      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_001', res.body);
    });
  });

  describe('basic plan, provider times out', () => {
    it('persists nothing in any store, because the payment outcome is unknown', async () => {
      const before = await env.persistence.snapshot();
      env.provider.willTimeout();

      await env.api.createSubscription(basicRequest());

      await env.persistence.expectUnchangedSince(before);
    });

    it('a retry after the timeout creates exactly one invoice and one audit entry', async () => {
      env.provider.timeoutOnce();
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'key-1' });

      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'key-1' });

      await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      ]);
    });
  });

  describe('pro plan (trial, nothing charged yet)', () => {
    it('writes no invoice and no audit entry', async () => {
      const res = await env.api.createSubscription(proRequest());

      await env.persistence.expectNoInvoices();
      await env.persistence.expectNoAuditEntries(res.body.id);
    });
  });

  describe('payment method', () => {
    it.each([
      ['basic', basicRequest, 'pm_test_mastercard_5555'],
      ['pro', proRequest, 'pm_test_visa_4242'],
    ])('is stored on the %s subscription so later billing can use it', async (_plan, request, paymentMethodId) => {
      const res = await env.api.createSubscription(request());

      await env.persistence.expectStoredPaymentMethod(res.body.id, paymentMethodId);
    });

    it('is never exposed in the API response', async () => {
      const created = await env.api.createSubscription(basicRequest());
      const fetched = await env.api.getSubscription(created.body.id);

      expect(JSON.stringify(created.body)).not.toContain('pm_test');
      expect(JSON.stringify(fetched.body)).not.toContain('pm_test');
    });
  });

  describe('idempotent creation replay', () => {
    it('adds no second invoice or audit entry', async () => {
      await env.api.createSubscription(basicRequest(), { idempotencyKey: 'key-1' });
      const before = await env.persistence.snapshot();

      const replay = await env.api.createSubscription(basicRequest(), { idempotencyKey: 'key-1' });

      expect(replay.status).toBe(200);
      await env.persistence.expectUnchangedSince(before);
    });
  });

  describe('rejected creation', () => {
    it.each([
      ['unknown plan', () => aSubscriptionRequest().onPlan('enterprise').build()],
      ['unknown customer', () => aSubscriptionRequest().forCustomer('cust_nope').build()],
      ['bad payment method', () => aSubscriptionRequest().withPaymentMethod('visa').build()],
      ['missing field', () => aSubscriptionRequest().without('plan').build()],
    ])('%s leaves every store untouched', async (_name, request) => {
      const before = await env.persistence.snapshot();

      await env.api.createSubscription(request());

      await env.persistence.expectUnchangedSince(before);
    });
  });

  describe('cancel', () => {
    it('records active -> canceled in the audit log, after the creation entry', async () => {
      const created = await env.api.createSubscription(basicRequest());

      const canceled = await env.api.cancelSubscription(created.body.id);

      await env.persistence.expectAuditTrail('sub_001', [
        { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
        { from: 'active', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
      await env.persistence.expectCoherent('sub_001', canceled.body);
    });

    it('records trialing -> canceled for a trialing pro subscription and writes no invoice', async () => {
      const created = await env.api.createSubscription(proRequest());

      await env.api.cancelSubscription(created.body.id);

      await env.persistence.expectAuditTrail(created.body.id, [
        { from: 'trialing', to: 'canceled', trigger: 'cancel', source: 'api' },
      ]);
      await env.persistence.expectNoInvoices();
    });

    it('a rejected second cancel adds no audit entry', async () => {
      const created = await env.api.createSubscription(proRequest());
      await env.api.cancelSubscription(created.body.id);
      const before = await env.persistence.snapshot();

      const second = await env.api.cancelSubscription(created.body.id);

      expect(second.status).toBe(409);
      await env.persistence.expectUnchangedSince(before);
    });

    it('a rejected cancel from past_due adds no audit entry', async () => {
      await env.seedSubscription(aSubscriptionRecord().inStatus('past_due').build());
      const before = await env.persistence.snapshot();

      const res = await env.api.cancelSubscription('sub_seed_001');

      expect(res.status).toBe(409);
      await env.persistence.expectUnchangedSince(before);
    });

    it('does not call the provider', async () => {
      const created = await env.api.createSubscription(proRequest());

      await env.api.cancelSubscription(created.body.id);

      env.providerCalls.expectNoCharges();
    });
  });
});
