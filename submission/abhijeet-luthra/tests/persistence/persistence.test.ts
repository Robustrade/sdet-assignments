import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { expectApiMatchesDb } from '../support/assertions/expectations';
import { givenActiveSubscription } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/** DB-01..03: persisted state matches the API and the business rules at EVERY stage. */
describe('Persistence and auditability', () => {
  const env = useTestEnvironment();

  test('DB-01 + DB-02 full journey: API == DB at every stage, audit history complete and ordered', async () => {
    const created = await givenActiveSubscription(env);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('active');

    env.provider.willDecline();
    await env.advanceDaysAndRunBilling(30);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('past_due');

    env.provider.willSucceed();
    await env.advanceDaysAndRunBilling(1);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('active');

    await env.api.cancel(created.id);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('canceled');

    const audit = env.auditOf(created.id);
    expect(audit.map((e) => [e.sequence, e.previousStatus, e.newStatus, e.trigger])).toEqual([
      [1, null, 'trialing', 'api_create'],
      [2, 'trialing', 'active', 'billing_charge'],
      [3, 'active', 'past_due', 'billing_charge'],
      [4, 'past_due', 'active', 'billing_charge'],
      [5, 'active', 'canceled', 'api_cancel'],
    ]);
    // Timestamps are coherent: audit is chronological and ends at canceled_at.
    const times = audit.map((e) => e.createdAt);
    expect([...times].sort()).toEqual(times);
    expect(times.at(-1)).toBe(env.subscription(created.id).canceledAt);
  });

  test.each([
    ['basic', 1900],
    ['pro', 4900],
  ])('DB-03 %s plan: invoice amount and currency follow the plan configuration (%i USD minor units)', async (plan, amount) => {
    const res = await env.api.create(aSubscriptionRequest().onPlan(plan).build());
    if (plan === 'pro') await env.advanceDaysAndRunBilling(7);

    const invoice = env.latestInvoiceOf(res.body.id);
    expect(invoice).toMatchObject({ amountMinor: amount, currency: 'USD' });
    expect(env.provider.lastCall()).toMatchObject({ amountMinor: amount, currency: 'USD' });
  });

  test('every payment references an invoice of the same subscription and carries its amount', async () => {
    const created = await givenActiveSubscription(env);
    for (const payment of env.paymentsOf(created.id)) {
      const invoice = env.repos.invoices.findById(payment.invoiceId)!;
      expect(invoice.subscriptionId).toBe(payment.subscriptionId);
      expect(payment.amountMinor).toBe(invoice.amountMinor);
    }
  });
});
