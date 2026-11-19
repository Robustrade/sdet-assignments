import { aWebhook } from '../support/builders/webhook-builder';
import { expectNoDatabaseChanges, statuses } from '../support/assertions/expectations';
import { givenActiveSubscription, givenTimedOutFirstCharge } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/**
 * REC-01..04: which payment attempt does an event refer to? (API_CONTRACTS §6.1)
 * Prefer provider_reference; otherwise only an unambiguous single unresolved
 * attempt; otherwise quarantine and change nothing.
 */
describe('Webhook -> payment-attempt matching', () => {
  const env = useTestEnvironment();

  test('REC-01 provider_reference matching a stored attempt updates exactly that attempt', async () => {
    const sub = await givenActiveSubscription(env);
    const reference = env.paymentsOf(sub.id)[0].providerReference!;

    const res = await env.webhooks.deliver(
      aWebhook().refunded().forInvoice(env.latestInvoiceOf(sub.id)).withProviderReference(reference).withEventId('evt_rec_01').build(),
    );

    expect(res.body.status).toBe('processed');
    expect(env.repos.payments.findByProviderReference(reference)?.status).toBe('refunded');
    expect(env.webhookEvent('evt_rec_01')?.matchedPaymentId).toBe(env.paymentsOf(sub.id)[0].id);
  });

  test('REC-02 no provider_reference + exactly one unresolved attempt -> reconciled, no new charge', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const [attempt] = env.paymentsOf(sub.id);

    const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.id)).withEventId('evt_rec_02').build());

    expect(res.body.status).toBe('processed');
    expect(attempt).toMatchObject({ status: 'timed_out', failureCode: 'provider_timeout' });
    expect(env.repos.payments.findById(attempt.id)).toMatchObject({ status: 'succeeded', failureCode: null });
    expect(env.webhookEvent('evt_rec_02')?.matchedPaymentId).toBe(attempt.id);
    expect(env.subscription(sub.id).status).toBe('active');
    expect(env.provider.callCount).toBe(1);
  });

  test('REC-02b provider_reference not yet stored (timed out before a reference was known) is attached to the single unresolved attempt', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const res = await env.webhooks.deliver(
      aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.id)).withProviderReference('pr_from_provider').build(),
    );
    expect(res.body.status).toBe('processed');
    expect(env.paymentsOf(sub.id)[0]).toMatchObject({ status: 'succeeded', providerReference: 'pr_from_provider' });
  });

  test('REC-03 no provider_reference + TWO unresolved attempts -> quarantined, nothing financial changes', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const invoice = env.latestInvoiceOf(sub.id);
    // Deliberately seed an inconsistent state the service itself never creates:
    // a second unresolved attempt on the same invoice.
    const [first] = env.paymentsOf(sub.id);
    env.repos.payments.insert({ ...first, id: 'pay_seeded', attemptNumber: 2, idempotencyKey: `${invoice.id}:2`, status: 'pending' });
    const before = env.repos.snapshots.snapshot();

    const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).withEventId('evt_ambiguous').build());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'quarantined', reason: 'ambiguous_payment_attempt' });
    expect(env.webhookEvent('evt_ambiguous')).toMatchObject({
      processingStatus: 'quarantined',
      ignoreReason: 'ambiguous_payment_attempt',
      matchedPaymentId: null,
    });
    // Only the webhook_events table gained a row; payments/invoice/subscription/audit are untouched.
    const after = env.repos.snapshots.snapshot();
    expect({ ...after, webhook_events: [] }).toEqual({ ...before, webhook_events: [] });
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['timed_out', 'pending']);
    expect(env.subscription(sub.id).status).toBe('trialing');
  });

  test('REC-04 provider_reference that belongs to a different invoice -> 422, nothing changes', async () => {
    const paid = await givenActiveSubscription(env);
    const otherReference = env.paymentsOf(paid.id)[0].providerReference!;
    const pending = await givenTimedOutFirstCharge(env);
    const before = env.repos.snapshots.snapshot();

    const res = await env.webhooks.deliver(
      aWebhook().succeeded().forInvoice(env.latestInvoiceOf(pending.id)).withProviderReference(otherReference).build(),
    );

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('EVENT_REFERENCE_MISMATCH');
    expectNoDatabaseChanges(env, before);
  });
});
