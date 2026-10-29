import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { aSubscriptionRequest } from '../../framework/builders/SubscriptionRequestBuilder';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * Overlapping work on one subscription. These run with `slowStorage: true`, which makes every
 * repository call yield to the event loop; without it the in-memory stores are effectively atomic and
 * these specs would pass even without the per-subscription lock (see TEST_STRATEGY.md, section 12).
 */
describe('billing run races', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = TestEnvironment.create({ slowStorage: true });
    await env.api.createSubscription(aSubscriptionRequest().onPlan('pro').build()); // sub_001, trialing
    env.clock.advanceDays(14);
  });

  it('two billing runs at the same moment charge a due subscription once', async () => {
    const [first, second] = await Promise.all([env.runBilling(), env.runBilling()]);

    expect(first.length + second.length).toBe(1);
    env.providerCalls.expectCallCount(1);
    await env.persistence.expectInvoiceStatuses('sub_001', ['paid']);
    await env.persistence.expectAuditTrail('sub_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'scheduler' },
    ]);
  });

  it('five overlapping runs still make exactly one provider call for one billing attempt', async () => {
    await Promise.all(Array.from({ length: 5 }, () => env.runBilling()));

    env.providerCalls.expectCallCount(1);
    await env.persistence.expectInvoiceCount('sub_001', 1);
  });

  it('a cancel racing with the billing run ends canceled with records that agree, whichever goes first', async () => {
    await Promise.all([env.runBilling(), env.api.cancelSubscription('sub_001')]);

    const res = await env.api.getSubscription('sub_001');
    expect(res.body.status).toBe('canceled');
    await env.persistence.expectCoherent('sub_001', res.body);
    // Either the cancel won (no charge at all) or the charge completed first (one paid invoice, then canceled).
    const charges = env.provider.calls.length;
    expect([0, 1]).toContain(charges);
    await env.persistence.expectInvoiceCount('sub_001', charges);
    await env.persistence.expectAuditPath(
      'sub_001',
      charges === 0 ? ['trialing', 'canceled'] : ['trialing', 'active', 'canceled'],
    );
  });

  it('a webhook racing with the billing run settles the invoice once and the subscription ends coherent', async () => {
    env.provider.timeoutOnce();
    await env.runBilling(); // inv_001 pending
    const settle = aWebhookEvent().succeeded().withId('evt_race').forSubscription('sub_001').forInvoice('inv_001').withAmount(4900).build();

    await Promise.all([env.runBilling(), env.webhooks.deliver(settle)]);

    const res = await env.api.getSubscription('sub_001');
    expect(res.body.status).toBe('active');
    await env.persistence.expectInvoiceStatuses('sub_001', ['paid']); // one invoice, settled once
    await env.persistence.expectAuditPath('sub_001', ['trialing', 'active']); // by webhook or by resend, never both
    await env.persistence.expectCoherent('sub_001', res.body);
    expect(env.provider.calls.length).toBeLessThanOrEqual(2); // the timed-out call, plus at most one resend
  });
});
