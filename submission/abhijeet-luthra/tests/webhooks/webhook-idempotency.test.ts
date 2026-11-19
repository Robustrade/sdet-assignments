import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, statuses } from '../support/assertions/expectations';
import { givenActiveSubscription, givenPastDueSubscription, givenTimedOutFirstCharge } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/** IDEM-01..05 (assignment §D, mandatory): duplicates and out-of-order events. */
describe('Webhook idempotency and ordering', () => {
  const env = useTestEnvironment();

  test('IDEM-01 the same payment.succeeded event delivered 5 times is applied exactly once', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const invoice = env.latestInvoiceOf(sub.id);
    const event = aWebhook().succeeded().forInvoice(invoice).withEventId('evt_idem_01').build();

    const responses = [];
    for (let i = 0; i < 5; i++) responses.push(await env.webhooks.deliver(event));

    expect(responses.map((r) => r.body.status)).toEqual(['processed', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    expect(env.webhookEvent('evt_idem_01')).toMatchObject({ processingStatus: 'processed', deliveryCount: 5 });
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['succeeded']);
    expect(env.invoicesOf(sub.id)).toHaveLength(1);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->active']); // ONE transition
    expect(env.provider.callCount).toBe(1); // only the original charge; webhooks never charge
    await expectApiMatchesDb(env, sub.id);
  });

  test('IDEM-02 the same payment.failed event delivered twice moves to past_due once', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const event = aWebhook().failed().forInvoice(env.latestInvoiceOf(sub.id)).withEventId('evt_idem_02').build();

    const first = await env.webhooks.deliver(event);
    const second = await env.webhooks.deliver(event);

    expect([first.body.status, second.body.status]).toEqual(['processed', 'duplicate']);
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['failed']);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->past_due']);
  });

  test('IDEM-03 sync charge success, then the provider webhook for the same charge: no second payment, no extra audit', async () => {
    const sub = await givenActiveSubscription(env);
    const invoice = env.latestInvoiceOf(sub.id);
    const auditBefore = env.auditOf(sub.id).length;

    const res = await env.webhooks.deliver(
      aWebhook().succeeded().forInvoice(invoice).withProviderReference(env.provider.issuedReferences[0]).build(),
    );

    expect(res.body).toEqual({ status: 'ignored', reason: 'invoice_already_paid' });
    expect(env.paymentsOf(sub.id)).toHaveLength(1);
    expect(env.auditOf(sub.id)).toHaveLength(auditBefore);
    expect(env.provider.callCount).toBe(1);
  });

  test('IDEM-04 payment.failed (attempt 1) then payment.succeeded (attempt 2) for the same invoice is legitimate', async () => {
    const sub = await givenPastDueSubscription(env); // attempt 1 failed synchronously
    env.provider.willTimeout();
    await env.advanceDaysAndRunBilling(1); // retry = attempt 2, outcome unknown
    const invoice = env.latestInvoiceOf(sub.id);

    const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).build());

    expect(res.body.status).toBe('processed');
    expect(env.paymentsOf(sub.id).map((p) => [p.attemptNumber, p.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(env.subscription(sub.id).status).toBe('active');
  });

  test('IDEM-05 a duplicated payment.refunded is applied once and does not change the subscription state', async () => {
    const sub = await givenActiveSubscription(env);
    const refund = aWebhook().refunded().forInvoice(env.latestInvoiceOf(sub.id)).withEventId('evt_refund').build();

    const first = await env.webhooks.deliver(refund);
    const second = await env.webhooks.deliver(refund);

    expect([first.body.status, second.body.status]).toEqual(['processed', 'duplicate']);
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['refunded']);
    expect(env.latestInvoiceOf(sub.id).status).toBe('refunded');
    expect(env.subscription(sub.id).status).toBe('active'); // assumption A-08
  });
});
