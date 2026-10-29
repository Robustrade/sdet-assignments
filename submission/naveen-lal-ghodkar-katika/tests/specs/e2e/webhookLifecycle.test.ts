import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';
import { anInvoiceRecord } from '../../framework/builders/InvoiceRecordBuilder';

/**
 * Whole flows from API request / webhook delivery to persistence. After every step the cross-entity
 * coherence check runs against what the API says, so a contradiction is caught at the step that
 * introduced it, not at the end.
 */
describe('end to end: subscription lifecycle driven by API calls and webhooks', () => {
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

  it('E1: basic is charged and active, a webhook echo is ignored then deduplicated, cancel is final, a late success is ignored', async () => {
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').forCustomer('cust_002').build());
    expect(created.body.status).toBe('active');
    await expectCoherentWithApi('sub_001');
    env.providerCalls.expectCallCount(1);

    // The provider also sends a webhook for the charge we already know about.
    const echo = () => aWebhookEvent().succeeded().withId('evt_echo').forSubscription('sub_001').forInvoice('inv_001').withAmount(1900).build();
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(echo()), 'ignored');
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(echo()), 'duplicate');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');
    await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);

    await env.api.cancelSubscription('sub_001');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    const late = aWebhookEvent().succeeded().withId('evt_late').forSubscription('sub_001').forInvoice('inv_001').withAmount(1900).build();
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(late), 'ignored');
    expect((await expectCoherentWithApi('sub_001')).status).toBe('canceled');

    env.providerCalls.expectCallCount(1); // webhooks and cancel never charged
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'api' },
      { from: 'active', to: 'canceled', trigger: 'cancel', source: 'api' },
    ]);
    await env.persistence.expectWebhookEventCount(2);
  });

  it('E3: declined first charge is past_due; a retry that the provider reports as paid reactivates it', async () => {
    env.provider.willDecline('insufficient_funds');
    const created = await env.api.createSubscription(aSubscriptionRequest().onPlan('basic').build());
    expect(created.body.status).toBe('past_due');
    await expectCoherentWithApi('sub_001');
    await env.persistence.expectInvoiceStatuses('sub_001', ['failed']);

    // A retry invoice exists (the retry scheduler is a later phase, so it is arranged here).
    await env.seedInvoice(anInvoiceRecord().withId('inv_retry').forSubscription('sub_001').attempt(2).withAmount(1900).pending().build());
    const retryPaid = aWebhookEvent().succeeded().withId('evt_retry').forSubscription('sub_001').forInvoice('inv_retry').withAmount(1900);
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(retryPaid.build()), 'processed');

    expect((await expectCoherentWithApi('sub_001')).status).toBe('active');
    await env.persistence.expectInvoiceStatuses('sub_001', ['failed', 'paid']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'past_due', trigger: 'charge_failed', source: 'api' },
      { from: 'past_due', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_retry' },
    ]);
    env.providerCalls.expectCallCount(1); // the creation charge only
  });

  it('E4: active -> recurring failure -> three failed attempts -> canceled; later webhooks are ignored', async () => {
    await env.seedBilling('active', ['paid', 'pending']);
    const fail = (id: string, invoice: string) => aWebhookEvent().failed().withId(id).forInvoice(invoice).build();

    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(fail('evt_f1', 'inv_seed_002')), 'processed');
    expect((await expectCoherentWithApi('sub_seed_001')).status).toBe('past_due');

    await env.seedInvoice(anInvoiceRecord().withId('inv_seed_003').attempt(3).pending().build());
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(fail('evt_f2', 'inv_seed_003')), 'processed');
    expect((await expectCoherentWithApi('sub_seed_001')).status).toBe('past_due');

    await env.seedInvoice(anInvoiceRecord().withId('inv_seed_004').attempt(4).pending().build());
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(fail('evt_f3', 'inv_seed_004')), 'processed');
    expect((await expectCoherentWithApi('sub_seed_001')).status).toBe('canceled');

    const late = aWebhookEvent().succeeded().withId('evt_late').forInvoice('inv_seed_004').build();
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(late), 'ignored');
    expect((await expectCoherentWithApi('sub_seed_001')).status).toBe('canceled');

    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid', 'failed', 'failed', 'failed']);
    await env.persistence.expectAuditTrail('sub_seed_001', [
      { from: 'active', to: 'past_due', trigger: 'charge_failed', source: 'webhook', eventId: 'evt_f1' },
      { from: 'past_due', to: 'canceled', trigger: 'retries_exhausted', source: 'webhook', eventId: 'evt_f3' },
    ]);
    env.providerCalls.expectNoCharges();
  });

  it('E6: a forged webhook is rejected at every point of the lifecycle and changes nothing', async () => {
    await env.seedBilling('trialing', ['pending']);
    const forged = () => env.webhooks.signedWithWrongSecret(aWebhookEvent().succeeded().withId('evt_forged').build());
    const genuine = (type: 'succeeded' | 'failed' | 'refunded', id: string) =>
      aWebhookEvent()[type]().withId(id).build();

    const expectForgeryRejected = async () => {
      const before = await env.persistence.snapshot();
      BillingAssertions.expectError(await env.webhooks.send(forged()), 401, 'invalid_signature');
      await env.persistence.expectUnchangedSince(before);
    };

    await expectForgeryRejected(); // while trialing
    await env.webhooks.deliver(genuine('succeeded', 'evt_1'));
    await expectForgeryRejected(); // while active
    await env.webhooks.deliver(genuine('refunded', 'evt_2'));
    await env.api.cancelSubscription('sub_seed_001');
    await expectForgeryRejected(); // while canceled

    expect((await expectCoherentWithApi('sub_seed_001')).status).toBe('canceled');
    env.providerCalls.expectNoCharges();
  });
});
