import { BILLING_PERIOD_DAYS } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

/** Events arrive in whatever order the provider's queue produces. State must never move backwards. */
describe('Out-of-order and stale webhook delivery', () => {
  const env = useHarness();

  it('payment.failed arriving AFTER payment.succeeded for the same invoice does not regress an active subscription', async () => {
    const { subscriptionId, invoiceId } = await env().given.signupChargeOutcomeUnknown();
    await env().webhooks.send(env().webhooks.about(invoiceId).paymentSucceeded().withChargeId('ch_a'));
    const dbBefore = env().snapshot();

    const staleFailure = await env().webhooks.send(env().webhooks.about(invoiceId).paymentFailed().withChargeId('ch_a'));

    expect(staleFailure.body).toMatchObject({ outcome: 'ignored', reason: 'invoice_paid' });
    const stored = env().stored(subscriptionId);
    expect(stored.status).toBe('active');
    expect(stored.latestInvoice).toMatchObject({ status: 'paid', failedAttempts: 0 });
    expect(stored.notificationKinds()).not.toContain('payment_failed');
    expect(env().tablesChangedSince(dbBefore)).toEqual(['webhook_events']);
  });

  it('payment.succeeded for an already-canceled subscription does not reactivate it', async () => {
    const { subscriptionId, invoiceId } = await env().given.canceledByExhaustedRetries();
    const dbBefore = env().snapshot();

    const response = await env().webhooks.send(env().webhooks.about(invoiceId).paymentSucceeded().withChargeId('ch_late'));

    expect(response.body).toMatchObject({ outcome: 'ignored', reason: 'subscription_canceled' });
    expect(env().stored(subscriptionId).status).toBe('canceled');
    expect(env().repos.invoices.findById(invoiceId)?.status).toBe('uncollectible');
    expect(env().tablesChangedSince(dbBefore)).toEqual(['webhook_events']);
  });

  it('a late success for the PREVIOUS period does not touch the current, failing renewal', async () => {
    const { subscriptionId, invoiceId: firstPeriodInvoiceId } = await env().given.active();
    env().gateway.willDecline();
    await env().advanceDaysAndBill(BILLING_PERIOD_DAYS); // renewal fails -> past_due
    const renewalInvoiceId = env().latestInvoiceId(subscriptionId);

    const response = await env().webhooks.send(env().webhooks.about(firstPeriodInvoiceId).paymentSucceeded());

    expect(response.body).toMatchObject({ outcome: 'ignored', reason: 'invoice_paid' });
    expect(env().stored(subscriptionId).status).toBe('past_due');
    expect(env().repos.invoices.findById(renewalInvoiceId)).toMatchObject({ status: 'open', failedAttempts: 1 });
  });

  it('a webhook settles the charge while our synchronous call is still waiting: the late reply is not applied twice', async () => {
    const { subscriptionId, invoiceId } = await env().given.pastDue();
    env().gateway.willSucceed();
    env().clock.set(env().repos.invoices.findById(invoiceId)!.nextRetryAt!);
    const inFlight = env().gateway.holdNextCall();
    const billingRun = env().runBilling();
    await inFlight.reached; // retry is with the provider
    expect(env().repos.attempts.findByInvoice(invoiceId)[1]!.status).toBe('pending');

    // The provider's webhook overtakes its own synchronous reply.
    await env().webhooks.send(env().webhooks.about(invoiceId).paymentSucceeded());
    inFlight.release();
    await billingRun;

    const attemptStatuses = env().repos.attempts.findByInvoice(invoiceId).map((attempt) => attempt.status);
    const receipts = env().stored(subscriptionId).notificationKinds().filter((kind) => kind === 'payment_receipt');
    expect(attemptStatuses).toEqual(['declined', 'succeeded']);
    expect(receipts).toHaveLength(1);
  });
});
