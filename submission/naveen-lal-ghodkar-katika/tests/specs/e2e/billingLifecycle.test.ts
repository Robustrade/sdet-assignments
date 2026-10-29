import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * Whole billing flows across every layer: API request or billing run -> mock provider call ->
 * webhook processing -> subscription state -> invoice records -> audit history.
 * After every step the cross-entity coherence check runs against what the API reports, and at the end
 * of each flow the provider's idempotency keys must be exactly the invoices' keys (one charge per
 * billing attempt, nothing charged that was not recorded, nothing recorded that was not charged).
 */
describe('end to end: billing lifecycle (API, billing run, provider mock, webhooks)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  const expectCoherentWithApi = async (id: string) => {
    const res = await env.api.getSubscription(id);
    expect(res.status).toBe(200);
    await env.persistence.expectCoherent(id, res.body);
    return res.body;
  };

  const expectOneChargePerInvoice = async (id: string) => {
    await env.persistence.expectInvoiceKeys(id, env.providerCalls.idempotencyKeys());
  };

  const event = (type: 'succeeded' | 'failed' | 'refunded', eventId: string, invoiceId: string, amount: number) =>
    aWebhookEvent().with('type', `payment.${type}`).withId(eventId).forSubscription('sub_001').forInvoice(invoiceId).withAmount(amount).build();

  it('E2: pro trial -> trial-end charge -> active -> echo webhooks -> recurring charge -> cancel -> nothing more', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    expect(created.status).toBe(201);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('trialing');
    env.providerCalls.expectNoCharges();

    env.clock.advanceDays(13);
    expect(await env.runBilling()).toEqual([]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('trialing');

    env.clock.advanceDays(1); // trial over
    expect(await env.runBilling()).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'paid' }]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    // The provider also notifies us of the charge we already know about; a redelivery is a duplicate.
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_echo', 'inv_001', 4900)), 'ignored');
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_echo', 'inv_001', 4900)), 'duplicate');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    env.clock.advanceDays(30);
    expect(await env.runBilling()).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    await env.api.cancelSubscription('sub_001');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_late', 'inv_002', 4900)), 'ignored');
    env.clock.advanceDays(120);
    expect(await env.runBilling()).toEqual([]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    env.providerCalls.expectCallCount(2);
    await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'paid']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
      { from: 'active', to: 'canceled', trigger: 'cancel', source: 'api' },
    ]);
    await env.persistence.expectWebhookEventCount(2);
    await expectOneChargePerInvoice('sub_001');
  });

  it('E3: pro trial-end decline -> past_due -> retry succeeds -> active, then recurring billing resumes', async () => {
    await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    env.provider.declineOnce('insufficient_funds');
    env.clock.advanceDays(14);

    await env.runBilling();
    expect((await expectCoherentWithApi('sub_001')).status).toBe('past_due');
    await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);

    env.clock.advanceDays(1);
    expect(await env.runBilling()).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_002', attempt: 2, outcome: 'paid' }]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    env.clock.advanceDays(29);
    expect(await env.runBilling()).toEqual([]); // 29 days after the retry payment
    env.clock.advanceDays(1);
    expect(await env.runBilling()).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_003', attempt: 3, outcome: 'paid' }]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'paid', 'paid']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'scheduler' },
      { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
    ]);
    env.providerCalls.expectCallCount(3);
    await expectOneChargePerInvoice('sub_001');
  });

  it('E4: basic active -> recurring decline -> two failed retries -> canceled; later webhooks and runs change nothing', async () => {
    await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');
    env.provider.willDecline('card_declined');

    env.clock.advanceDays(30);
    await env.runBilling(); // attempt 2 fails: active -> past_due
    expect((await expectCoherentWithApi('sub_001')).status).toBe('past_due');

    env.clock.advanceDays(1);
    await env.runBilling(); // attempt 3 fails: still past_due
    expect((await expectCoherentWithApi('sub_001')).status).toBe('past_due');

    env.clock.advanceDays(1);
    await env.runBilling(); // attempt 4 fails: third in a row
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_late', 'inv_004', 1900)), 'ignored');
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('failed', 'evt_late_fail', 'inv_004', 1900)), 'ignored');
    env.clock.advanceDays(90);
    expect(await env.runBilling()).toEqual([]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    await env.persistence.expectInvoiceStatuses('sub_001', ['paid', 'failed', 'failed', 'failed']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      { from: 'active', to: 'past_due', trigger: 'charge_failed', source: 'scheduler' },
      { from: 'past_due', to: 'canceled', trigger: 'retries_exhausted', source: 'scheduler' },
    ]);
    env.providerCalls.expectCallCount(4);
    await expectOneChargePerInvoice('sub_001');
  });

  it('E5: provider timeout at trial end -> state unchanged -> webhook resolves it -> redelivery is a duplicate -> no extra charge', async () => {
    await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    env.provider.timeoutOnce();
    env.clock.advanceDays(14);

    expect(await env.runBilling()).toEqual([{ subscriptionId: 'sub_001', invoiceId: 'inv_001', attempt: 1, outcome: 'timeout' }]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('trialing');
    await env.persistence.expectInvoiceStatuses('sub_001', ['pending']);

    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_resolve', 'inv_001', 4900)), 'processed');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event('succeeded', 'evt_resolve', 'inv_001', 4900)), 'duplicate');
    expect(await env.runBilling()).toEqual([]);
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');

    env.providerCalls.expectCallCount(1);
    await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_resolve' },
    ]);
    await env.persistence.expectWebhookEvent('evt_resolve', { outcome: 'processed', deliveryCount: 2 });
    await expectOneChargePerInvoice('sub_001');
  });

  it('E6: forged webhooks are rejected at every step of a billing lifecycle and change nothing', async () => {
    const forged = () => env.webhooks.signedWithWrongSecret(event('succeeded', 'evt_forged', 'inv_001', 4900));
    const expectForgeryRejected = async () => {
      const before = await env.persistence.snapshot();
      BillingAssertions.expectError(await env.webhooks.send(forged()), 401, 'invalid_signature');
      await env.persistence.expectUnchangedSince(before);
    };

    await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build());
    await expectForgeryRejected(); // trialing
    env.provider.timeoutOnce();
    env.clock.advanceDays(14);
    await env.runBilling();
    await expectForgeryRejected(); // trialing with a pending invoice: a forgery must not settle it
    await env.runBilling();
    await expectForgeryRejected(); // active
    await env.api.cancelSubscription('sub_001');
    await expectForgeryRejected(); // canceled

    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');
    env.providerCalls.expectCallCount(2); // the timed-out attempt and its resend
    await env.persistence.expectNoWebhookEvents();
  });
});
