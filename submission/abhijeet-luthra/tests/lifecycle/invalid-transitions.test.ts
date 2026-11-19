import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, statuses } from '../support/assertions/expectations';
import { givenPastDueSubscription, givenTimedOutFirstCharge } from '../support/fixtures/given';
import { TestEnvironment, useTestEnvironment } from '../support/fixtures/test-environment';

/** Everything except webhook_events must be unchanged ("ignored" events are recorded, nothing else). */
function expectOnlyWebhookEventsChanged(env: TestEnvironment, before: ReturnType<TestEnvironment['repos']['snapshots']['snapshot']>) {
  expect({ ...env.repos.snapshots.snapshot(), webhook_events: [] }).toEqual({ ...before, webhook_events: [] });
}

/** INV-01..05 (assignment §E): invalid transitions are rejected or safely ignored. */
describe('Invalid transitions are impossible', () => {
  const env = useTestEnvironment();

  /** A realistic late event: the first charge timed out, the customer canceled, then the provider reports. */
  async function canceledWithUnresolvedCharge() {
    const sub = await givenTimedOutFirstCharge(env);
    await env.api.cancel(sub.id);
    return { sub, invoice: env.latestInvoiceOf(sub.id) };
  }

  test('INV-01 canceled + late payment.succeeded -> ignored, stays canceled (no reactivation)', async () => {
    const { sub, invoice } = await canceledWithUnresolvedCharge();
    const before = env.repos.snapshots.snapshot();

    const res = await env.webhooks.deliver(aWebhook().succeeded().forInvoice(invoice).withEventId('evt_late_success').build());

    expect(res.body).toEqual({ status: 'ignored', reason: 'subscription_canceled' });
    expect((await expectApiMatchesDb(env, sub.id)).status).toBe('canceled');
    expect(env.webhookEvent('evt_late_success')?.processingStatus).toBe('ignored');
    expectOnlyWebhookEventsChanged(env, before);
  });

  test('INV-02 canceled + payment.failed -> ignored, stays canceled', async () => {
    const { sub, invoice } = await canceledWithUnresolvedCharge();
    const before = env.repos.snapshots.snapshot();

    const res = await env.webhooks.deliver(aWebhook().failed().forInvoice(invoice).build());

    expect(res.body).toEqual({ status: 'ignored', reason: 'subscription_canceled' });
    expect(env.subscription(sub.id).status).toBe('canceled');
    expectOnlyWebhookEventsChanged(env, before);
  });

  describe('INV-03 payment.failed AFTER payment.succeeded for the same invoice does not regress', () => {
    test.each([
      ['without provider_reference', false],
      ['with the same provider_reference', true],
    ])('%s', async (_name, withReference) => {
      const sub = await givenTimedOutFirstCharge(env);
      const invoice = env.latestInvoiceOf(sub.id);
      const success = aWebhook().succeeded().forInvoice(invoice).withEventId('evt_success');
      const failure = aWebhook().failed().forInvoice(invoice).withEventId('evt_stale_failure');
      if (withReference) {
        success.withProviderReference('pr_same');
        failure.withProviderReference('pr_same');
      }

      expect((await env.webhooks.deliver(success.build())).body.status).toBe('processed');
      const before = env.repos.snapshots.snapshot();
      const res = await env.webhooks.deliver(failure.build());

      expect(res.body).toEqual({ status: 'ignored', reason: 'invoice_already_paid' });
      expect(statuses(env.paymentsOf(sub.id))).toEqual(['succeeded']);
      expect((await expectApiMatchesDb(env, sub.id)).status).toBe('active');
      expectOnlyWebhookEventsChanged(env, before);
    });
  });

  test('INV-04 cancel an already-canceled subscription -> 409', async () => {
    const { sub } = await canceledWithUnresolvedCharge();
    expect((await env.api.cancel(sub.id)).status).toBe(409);
  });

  test('INV-05 cancel a past_due subscription -> 409 (not a listed transition)', async () => {
    const sub = await givenPastDueSubscription(env);
    expect((await env.api.cancel(sub.id)).status).toBe(409);
    expect(env.subscription(sub.id).status).toBe('past_due');
  });

  test('canceled subscriptions are never billed again', async () => {
    const { sub } = await canceledWithUnresolvedCharge();
    const calls = env.provider.callCount;
    await env.advanceDaysAndRunBilling(60);
    expect(env.provider.callCount).toBe(calls);
    expect(env.subscription(sub.id).status).toBe('canceled');
  });
});
