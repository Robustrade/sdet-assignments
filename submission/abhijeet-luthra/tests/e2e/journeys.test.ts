import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, expectedChargeRequest, statuses } from '../support/assertions/expectations';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/**
 * E2E-01..06: complete business journeys through the public HTTP surface, the
 * billing runner, the mocked provider and SQLite - asserting all three views
 * (API, database, provider) along the way.
 */
describe('End-to-end journeys', () => {
  const env = useTestEnvironment();

  test('E2E-01 trial signup -> trial ends -> charge succeeds -> active', async () => {
    const created = (await env.api.create(aSubscriptionRequest().onPlan('pro').build())).body;
    expect(created.status).toBe('trialing');
    expect(env.provider.callCount).toBe(0);

    await env.advanceDaysAndRunBilling(7);

    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('active');
    expect(env.provider.calls).toEqual([expectedChargeRequest(sub, env.latestInvoiceOf(sub.id), 1)]);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->active']);
  });

  test('E2E-02 immediate signup -> active -> renewal declined -> past_due -> retry succeeds -> active', async () => {
    const created = (await env.api.create(aSubscriptionRequest().onPlan('basic').build())).body;
    expect(created.status).toBe('active');

    env.provider.willDecline();
    await env.advanceDaysAndRunBilling(30);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('past_due');

    env.provider.willSucceed();
    await env.advanceDaysAndRunBilling(1);
    const sub = await expectApiMatchesDb(env, created.id);
    expect(sub.status).toBe('active');

    const renewal = env.latestInvoiceOf(sub.id);
    expect(renewal.status).toBe('paid');
    expect(env.repos.payments.findByInvoice(renewal.id).map((p) => [p.attemptNumber, p.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->active', 'active->past_due', 'past_due->active']);
  });

  test('E2E-03 retries exhausted -> canceled -> late payment.succeeded webhook -> still canceled, no new charge', async () => {
    env.provider.willDecline('card_declined', 3);
    const created = (await env.api.create(aSubscriptionRequest().onPlan('basic').build())).body;
    await env.advanceDaysAndRunBilling(1);
    await env.advanceDaysAndRunBilling(1);
    expect(env.subscription(created.id).status).toBe('canceled');

    const lastReference = env.provider.issuedReferences[2];
    const res = await env.webhooks.deliver(
      aWebhook().succeeded().forInvoice(env.latestInvoiceOf(created.id)).withProviderReference(lastReference).build(),
    );

    expect(res.body).toEqual({ status: 'ignored', reason: 'subscription_canceled' });
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('canceled');
    expect(statuses(env.paymentsOf(created.id))).toEqual(['failed', 'failed', 'failed']);
    expect(env.provider.callCount).toBe(3);
  });

  test('E2E-04 duplicate and out-of-order webhooks: success x3 (same event), then failure for the same invoice', async () => {
    env.provider.willTimeout();
    const created = (await env.api.create(aSubscriptionRequest().onPlan('basic').build())).body;
    const invoice = env.latestInvoiceOf(created.id);
    const success = aWebhook().succeeded().forInvoice(invoice).withEventId('evt_e2e_success').build();

    const results = [];
    for (let i = 0; i < 3; i++) results.push((await env.webhooks.deliver(success)).body.status);
    results.push((await env.webhooks.deliver(aWebhook().failed().forInvoice(invoice).withEventId('evt_e2e_fail').build())).body.status);

    expect(results).toEqual(['processed', 'duplicate', 'duplicate', 'ignored']);
    expect(env.webhookEvent('evt_e2e_success')?.deliveryCount).toBe(3);
    expect(env.webhookEvent('evt_e2e_fail')?.ignoreReason).toBe('invoice_already_paid');
    expect(statuses(env.paymentsOf(created.id))).toEqual(['succeeded']);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('active');
    expect(env.provider.callCount).toBe(1);
  });

  test('E2E-05 provider timeout -> billing runner does not re-charge -> success webhook -> active, one charge', async () => {
    env.provider.willTimeout();
    const created = (await env.api.create(aSubscriptionRequest().onPlan('basic').build())).body;
    expect(created.status).toBe('trialing');

    await env.advanceDaysAndRunBilling(2);
    expect(env.provider.callCount).toBe(1);

    await env.webhooks.deliver(aWebhook().succeeded().forInvoice(env.latestInvoiceOf(created.id)).build());

    expect((await expectApiMatchesDb(env, created.id)).status).toBe('active');
    expect(env.paymentsOf(created.id)).toHaveLength(1);
    expect(env.provider.callCount).toBe(1);
  });

  test('E2E-06 cancel active -> period ends -> stray webhooks: no billing, no state change, API == DB', async () => {
    const created = (await env.api.create(aSubscriptionRequest().onPlan('basic').build())).body;
    const invoice = env.latestInvoiceOf(created.id);
    await env.api.cancel(created.id);

    expect(await env.advanceDaysAndRunBilling(30)).toEqual({ chargesAttempted: 0 });
    const stray = await Promise.all([
      env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).build()),
      env.webhooks.deliver(aWebhook().failed().forInvoice(invoice).build()),
    ]);

    expect(stray.map((r) => r.body.status)).toEqual(['ignored', 'ignored']);
    expect((await expectApiMatchesDb(env, created.id)).status).toBe('canceled');
    expect(env.invoicesOf(created.id)).toHaveLength(1);
    expect(env.provider.callCount).toBe(1);
  });
});
