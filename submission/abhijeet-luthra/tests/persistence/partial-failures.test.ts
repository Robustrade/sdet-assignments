import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { aWebhook } from '../support/builders/webhook-builder';
import { expectApiMatchesDb, expectNoDatabaseChanges, statuses } from '../support/assertions/expectations';
import { givenTimedOutFirstCharge } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/**
 * PF-01..03: failures part-way through. Failures are injected by making ONE real
 * repository call throw (jest.spyOn, like Mockito doThrow) - no test hooks exist
 * in the service code.
 */
describe('Partial failures and recovery', () => {
  const env = useTestEnvironment();

  test('PF-01 failure mid-webhook rolls back EVERYTHING; redelivery of the same event then applies once', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    const event = aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.id)).withEventId('evt_pf_01').build();
    const before = env.repos.snapshots.snapshot();
    // Payment and invoice updates succeed; the subscription update then fails before commit.
    jest.spyOn(env.repos.subscriptions, 'update').mockImplementationOnce(() => {
      throw new Error('simulated disk I/O error');
    });

    const failed = await env.webhooks.deliver(event);

    expect(failed.status).toBe(500);
    expect(failed.body.error?.code).toBe('INTERNAL_ERROR');
    expect(env.loggedErrors).toHaveLength(1);
    expectNoDatabaseChanges(env, before); // no event row, no payment/invoice/audit change

    const redelivered = await env.webhooks.deliver(event);

    expect(redelivered.body.status).toBe('processed');
    expect(env.webhookEvent('evt_pf_01')?.deliveryCount).toBe(1); // the rolled-back attempt left no trace
    expect(statuses(env.paymentsOf(sub.id))).toEqual(['succeeded']);
    expect(env.auditTrail(sub.id)).toEqual(['none->trialing', 'trialing->active']);
  });

  test('PF-02 provider charged but the local update failed: attempt stays pending, no double charge, webhook reconciles', async () => {
    env.provider.willSucceed();
    jest.spyOn(env.repos.invoices, 'updateStatus').mockImplementationOnce(() => {
      throw new Error('simulated crash after provider success');
    });
    const request = aSubscriptionRequest().onPlan('basic').build();

    const res = await env.api.create(request, { idempotencyKey: 'pf-02' });

    expect(res.status).toBe(500); // provider succeeded, local Tx B rolled back
    const [sub] = env.repos.subscriptions.findAll();
    expect(sub.status).toBe('trialing'); // Tx A committed: the subscription and pending attempt exist
    expect(env.paymentsOf(sub.id)).toEqual([expect.objectContaining({ status: 'pending', providerReference: null })]);
    expect(env.provider.callCount).toBe(1);

    // The client retries with its key: it gets the subscription back, no new charge.
    const retry = await env.api.create(request, { idempotencyKey: 'pf-02' });
    expect(retry.body.id).toBe(sub.id);
    // The billing runner does not charge again while the attempt is unresolved.
    await env.advanceDaysAndRunBilling(1);
    expect(env.provider.callCount).toBe(1);

    // The provider's webhook for the real charge reconciles the attempt.
    const reference = env.provider.issuedReferences[0];
    const hook = await env.webhooks.deliver(
      aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.id)).withProviderReference(reference).build(),
    );
    expect(hook.body.status).toBe('processed');
    expect(env.paymentsOf(sub.id)).toEqual([expect.objectContaining({ status: 'succeeded', providerReference: reference })]);
    expect((await expectApiMatchesDb(env, sub.id)).status).toBe('active');
    expect(env.provider.callCount).toBe(1);
  });

  test('PF-03 timeout leaves the subscription unchanged; a failure webhook resolves it and billing resumes with attempt 2', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    expect(env.subscription(sub.id).status).toBe('trialing');

    await env.webhooks.deliver(aWebhook().failed().forInvoice(env.latestInvoiceOf(sub.id)).build());
    expect(env.subscription(sub.id).status).toBe('past_due');

    env.provider.willSucceed();
    await env.advanceDaysAndRunBilling(1);
    expect(env.paymentsOf(sub.id).map((p) => [p.attemptNumber, p.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(env.subscription(sub.id).status).toBe('active');
    expect(env.provider.callCount).toBe(2);
  });
});
