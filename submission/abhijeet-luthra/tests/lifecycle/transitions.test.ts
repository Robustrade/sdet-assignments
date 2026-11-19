import { addDays } from '../../src/clock';
import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, expectedChargeRequest, statuses } from '../support/assertions/expectations';
import { givenActiveSubscription, givenPastDueSubscription, givenTrialingSubscription } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/**
 * LC-01..07: every required transition, driven by the billing runner (time),
 * by webhooks, and by API calls. Each test checks the API, the persisted rows,
 * the audit trail, and the provider call.
 */
describe('Subscription lifecycle - all required transitions', () => {
  const env = useTestEnvironment();

  test('LC-01 trialing -> active: trial ends, first charge succeeds (pro: 7-day trial, 4900)', async () => {
    const created = await givenTrialingSubscription(env);
    env.provider.willSucceed();

    expect(await env.advanceDaysAndRunBilling(6)).toEqual({ chargesAttempted: 0 }); // trial not over yet
    expect(await env.advanceDaysAndRunBilling(1)).toEqual({ chargesAttempted: 1 });

    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('active');
    const invoice = env.latestInvoiceOf(sub.id);
    expect(invoice).toMatchObject({ amountMinor: 4900, status: 'paid', periodStart: sub.trialEnd });
    expect(sub.currentPeriodEnd).toBe(addDays(sub.trialEnd, 30));
    expect(env.provider.calls).toEqual([expectedChargeRequest(sub, invoice, 1)]);
    expect(env.auditOf(sub.id).at(-1)).toMatchObject({ previousStatus: 'trialing', newStatus: 'active', trigger: 'billing_charge' });
  });

  test('LC-01w trialing -> active via payment.succeeded webhook reconciling a timed-out first charge', async () => {
    const created = await givenTrialingSubscription(env);
    env.provider.willTimeout();
    await env.advanceDaysAndRunBilling(7);
    expect(env.subscription(created.id).status).toBe('trialing'); // timeout is NOT a state change

    await env.webhooks.deliver(aWebhook().succeeded().forInvoice(env.latestInvoiceOf(created.id)).build());

    expect((await expectApiMatchesDb(env, created.id)).status).toBe('active');
    expect(env.auditOf(created.id).at(-1)).toMatchObject({ newStatus: 'active', trigger: 'webhook' });
  });

  test('LC-02 trialing -> past_due: trial ends, first charge fails', async () => {
    const created = await givenTrialingSubscription(env);
    env.provider.willDecline();

    await env.advanceDaysAndRunBilling(7);

    expect((await expectApiMatchesDb(env, created.id)).status).toBe('past_due');
    expect(statuses(env.paymentsOf(created.id))).toEqual(['failed']);
    expect(env.latestInvoiceOf(created.id).status).toBe('open');
  });

  test('LC-03 active -> past_due: recurring charge fails (new invoice for the next period)', async () => {
    const created = await givenActiveSubscription(env);
    env.provider.willDecline();

    await env.advanceDaysAndRunBilling(30);

    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('past_due');
    const [first, renewal] = env.invoicesOf(sub.id);
    expect([first.status, renewal.status]).toEqual(['paid', 'open']);
    expect(renewal.periodStart).toBe(first.periodEnd);
    expect(env.provider.lastCall()).toEqual(expectedChargeRequest(sub, renewal, 1));
  });

  test('LC-03w active -> past_due via payment.failed webhook reconciling a timed-out recurring attempt', async () => {
    const created = await givenActiveSubscription(env);
    env.provider.willTimeout();
    await env.advanceDaysAndRunBilling(30);
    expect(env.subscription(created.id).status).toBe('active');

    await env.webhooks.deliver(aWebhook().failed().forInvoice(env.latestInvoiceOf(created.id)).build());

    expect((await expectApiMatchesDb(env, created.id)).status).toBe('past_due');
  });

  test('LC-04 past_due -> active: retry charge succeeds (attempt 2 with a new idempotency key)', async () => {
    const created = await givenPastDueSubscription(env);
    env.provider.willSucceed();

    await env.advanceDaysAndRunBilling(1);

    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('active');
    const invoice = env.latestInvoiceOf(sub.id);
    expect(env.paymentsOf(sub.id).map((p) => [p.attemptNumber, p.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(env.provider.lastCall()).toEqual(expectedChargeRequest(sub, invoice, 2));
  });

  test('LC-05 past_due -> canceled: third failed attempt exhausts retries (assumption A-06)', async () => {
    const created = await givenPastDueSubscription(env); // attempt 1 failed
    env.provider.willDecline('card_declined', 2);

    await env.advanceDaysAndRunBilling(1); // attempt 2 fails -> still past_due
    expect(env.subscription(created.id).status).toBe('past_due');
    await env.advanceDaysAndRunBilling(1); // attempt 3 fails -> canceled

    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('canceled');
    expect(sub.canceledAt).not.toBeNull();
    expect(env.latestInvoiceOf(sub.id).status).toBe('void');
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['failed', 'failed', 'failed']);
    expect(env.provider.callCount).toBe(3);
    expect(env.auditOf(sub.id).at(-1)).toMatchObject({ previousStatus: 'past_due', newStatus: 'canceled', trigger: 'retries_exhausted' });

    expect(await env.advanceDaysAndRunBilling(30)).toEqual({ chargesAttempted: 0 }); // billing has stopped
  });

  test('LC-06 active -> canceled: customer cancels via API', async () => {
    const created = await givenActiveSubscription(env);
    expect((await env.api.cancel(created.id)).body.status).toBe('canceled');
    expect(env.auditTrail(created.id).at(-1)).toBe('active->canceled');
  });

  test('LC-07 trialing -> canceled: customer cancels via API', async () => {
    const created = await givenTrialingSubscription(env);
    expect((await env.api.cancel(created.id)).body.status).toBe('canceled');
    expect(env.auditTrail(created.id).at(-1)).toBe('trialing->canceled');
  });

  test('renewal success keeps active (not a state transition), extends the period and adds no audit row', async () => {
    const created = await givenActiveSubscription(env);
    const periodEnd = env.subscription(created.id).currentPeriodEnd!;
    const auditBefore = env.auditOf(created.id).length;

    await env.advanceDaysAndRunBilling(30);

    const sub = env.subscription(created.id);
    expect(sub.status).toBe('active');
    expect(sub.currentPeriodEnd).toBe(addDays(periodEnd, 30));
    expect(env.auditOf(sub.id)).toHaveLength(auditBefore);
    expect(env.invoicesOf(sub.id).map((i) => i.status)).toEqual(['paid', 'paid']);
  });
});
