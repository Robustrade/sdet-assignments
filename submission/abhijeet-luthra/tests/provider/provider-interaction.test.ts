import { aSubscriptionRequest } from '../support/builders/subscription-request-builder';
import { aWebhook } from '../support/builders/webhook-builder';
import { expectedChargeRequest } from '../support/assertions/expectations';
import { givenActiveSubscription, givenPastDueSubscription, givenTimedOutFirstCharge } from '../support/fixtures/given';
import { useTestEnvironment } from '../support/fixtures/test-environment';

/** PAY-01..05 (assignment §4, §F): what the provider is asked to do - and when it must NOT be asked. */
describe('Mocked payment provider interaction', () => {
  const env = useTestEnvironment();

  test('PAY-01 exactly one call per genuine attempt, with exact arguments (first charge, renewal, retry)', async () => {
    const created = await givenActiveSubscription(env); // first charge, succeeds
    env.provider.willDecline(); // renewal fails
    await env.advanceDaysAndRunBilling(30);
    env.provider.willSucceed(); // retry succeeds
    await env.advanceDaysAndRunBilling(1);

    const sub = env.subscription(created.id);
    const [first, renewal] = env.invoicesOf(sub.id);
    expect(env.provider.calls).toEqual([
      expectedChargeRequest(sub, first, 1),
      expectedChargeRequest(sub, renewal, 1),
      expectedChargeRequest(sub, renewal, 2),
    ]);
  });

  test('PAY-02 no call for: trial creation, rejected creation, GET, cancel, inbound webhooks, idempotent replay', async () => {
    const trial = await env.api.create(aSubscriptionRequest().onPlan('pro').build());
    await env.api.create(aSubscriptionRequest().onPlan('enterprise').build()); // rejected
    await env.api.get(trial.body.id);
    await env.api.cancel(trial.body.id);
    expect(env.provider.callCount).toBe(0);

    env.provider.willTimeout();
    const request = aSubscriptionRequest().onPlan('basic').build();
    const sub = await env.api.create(request, { idempotencyKey: 'pay-02' }); // the ONE genuine charge
    await env.webhooks.deliver(aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.body.id)).build());
    await env.api.create(request, { idempotencyKey: 'pay-02' }); // replay
    expect(env.provider.callCount).toBe(1);
  });

  test('PAY-03 a retry uses the next attempt number and a NEW idempotency key on the SAME invoice and amount', async () => {
    const created = await givenPastDueSubscription(env);
    await env.advanceDaysAndRunBilling(1);

    const [attempt1, attempt2] = env.provider.calls;
    expect(attempt2.invoiceId).toBe(attempt1.invoiceId);
    expect(attempt2.amountMinor).toBe(attempt1.amountMinor);
    expect(attempt1.idempotencyKey).toBe(`${attempt1.invoiceId}:1`);
    expect(attempt2.idempotencyKey).toBe(`${attempt1.invoiceId}:2`);
    expect(env.paymentsOf(created.id).map((p) => p.idempotencyKey)).toEqual([attempt1.idempotencyKey, attempt2.idempotencyKey]);
  });

  test('PAY-04 timeout: one call, never re-charged automatically, reconciled later by webhook', async () => {
    const sub = await givenTimedOutFirstCharge(env);
    expect(env.paymentsOf(sub.id)[0]).toMatchObject({ status: 'timed_out', failureCode: 'provider_timeout' });

    await env.advanceDaysAndRunBilling(1);
    await env.advanceDaysAndRunBilling(1);
    expect(env.provider.callCount).toBe(1); // unresolved attempt blocks new charges

    await env.webhooks.deliver(aWebhook().succeeded().forInvoice(env.latestInvoiceOf(sub.id)).build());
    expect(env.subscription(sub.id).status).toBe('active');
    expect(env.provider.callCount).toBe(1);
  });

  test('PAY-04b a timed-out RETRY on a past_due subscription is not retried again (no double charge)', async () => {
    const sub = await givenPastDueSubscription(env); // attempt 1 declined
    env.provider.willTimeout();
    await env.advanceDaysAndRunBilling(1); // attempt 2 times out: outcome unknown

    await env.advanceDaysAndRunBilling(1);
    await env.advanceDaysAndRunBilling(1);

    expect(env.provider.callCount).toBe(2);
    expect(env.paymentsOf(sub.id).map((p) => [p.attemptNumber, p.status])).toEqual([
      [1, 'failed'],
      [2, 'timed_out'],
    ]);
    expect(env.subscription(sub.id).status).toBe('past_due');
  });

  test('PAY-05 canceled subscription at period end: zero calls', async () => {
    const sub = await givenActiveSubscription(env);
    await env.api.cancel(sub.id);
    await env.advanceDaysAndRunBilling(31);
    expect(env.provider.callCount).toBe(1); // only the original charge
  });

  test('OPT-04 a non-timeout provider error is also treated as an UNKNOWN outcome (never as a decline)', async () => {
    jest.spyOn(env.provider, 'charge').mockRejectedValueOnce(new Error('ECONNRESET'));
    const res = await env.api.create(aSubscriptionRequest().onPlan('basic').build());

    expect(res.body.status).toBe('trialing');
    expect(env.paymentsOf(res.body.id)[0]).toMatchObject({ status: 'timed_out', failureCode: 'provider_error' });
  });
});
