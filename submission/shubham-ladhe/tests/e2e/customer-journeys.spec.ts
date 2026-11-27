import { aSignupRequest } from '../framework/builders';
import { PLANS, SEED } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

/**
 * Full journeys through every layer: HTTP request -> service -> provider double -> database,
 * with stored state compared to the API at each step (not only at the end).
 */
describe('Customer journeys (end to end)', () => {
  const env = useHarness();

  async function expectApiAndDbAgree(subscriptionId: string): Promise<void> {
    expect(await env().apiVsDbDifferences(subscriptionId)).toEqual([]);
  }

  it('basic: trial -> first charge declined -> retry succeeds -> renewal paid -> customer cancels', async () => {
    // 1. Sign up on a trial plan: no charge yet.
    const created = await env().api.createOk(aSignupRequest().onBasicPlan().build());
    expect(created).toMatchObject({ status: 'trialing', plan: 'basic', amount: PLANS.basic.priceCents, latest_invoice: null });
    expect(env().gateway.calls).toHaveLength(0);
    await expectApiAndDbAgree(created.id);

    // 2. Trial ends, first charge is declined.
    env().gateway.willDecline('insufficient_funds');
    await env().advanceDaysAndBill(PLANS.basic.trialDays);
    const firstInvoiceId = env().latestInvoiceId(created.id);
    expect(env().stored(created.id).status).toBe('past_due');
    expect(env().stored(created.id).latestInvoice).toMatchObject({
      status: 'open',
      failedAttempts: 1,
      amountCents: PLANS.basic.priceCents,
    });
    await expectApiAndDbAgree(created.id);

    // 3. Retry on schedule succeeds.
    env().gateway.willSucceed();
    await env().billAtNextRetry(firstInvoiceId);
    const afterRetry = env().stored(created.id);
    expect(afterRetry.status).toBe('active');
    expect(afterRetry.latestInvoice?.status).toBe('paid');
    expect(afterRetry.attemptsFor(firstInvoiceId).map((attempt) => attempt.status)).toEqual(['declined', 'succeeded']);
    await expectApiAndDbAgree(created.id);

    // 4. At the end of the period the renewal is charged and paid; still active.
    env().clock.set(afterRetry.subscription.currentPeriodEnd);
    await env().runBilling();
    expect(env().stored(created.id).status).toBe('active');
    expect(env().stored(created.id).invoices.map((invoice) => invoice.status)).toEqual(['paid', 'paid']);
    await expectApiAndDbAgree(created.id);

    // 5. Customer cancels; later billing runs never charge again.
    expect((await env().api.cancel(created.id)).status).toBe(200);
    const callsAtCancel = env().gateway.callCount();
    await env().advanceDaysAndBill(90);
    expect(env().gateway.callsSince(callsAtCancel)).toEqual([]);

    const final = env().stored(created.id);
    expect(final.statusHistory()).toEqual(['trialing', 'past_due', 'active', 'canceled']);
    expect(final.notificationKinds()).toEqual(['payment_failed', 'payment_receipt', 'payment_receipt', 'subscription_canceled']);
    await expectApiAndDbAgree(created.id);
  });

  it('pro: charged at signup, renewals keep failing, retries run out -> canceled and invoice uncollectible', async () => {
    const created = await env().api.createOk(aSignupRequest().onProPlan().build());
    expect(created.status).toBe('active');
    expect(env().gateway.calls).toEqual([
      expect.objectContaining({ customerId: SEED.alice.customerId, paymentMethodId: SEED.alice.card, amountCents: PLANS.pro.priceCents }),
    ]);

    env().gateway.alwaysDecline('card_expired');
    env().clock.set(created.current_period_end);
    await env().runBilling();
    const renewalInvoiceId = env().latestInvoiceId(created.id);
    expect(env().stored(created.id).status).toBe('past_due');

    await env().retryUntilSettled(renewalInvoiceId);

    const final = env().stored(created.id);
    expect(final.status).toBe('canceled');
    expect(final.subscription.cancelReason).toBe('retries_exhausted');
    expect(final.latestInvoice).toMatchObject({ id: renewalInvoiceId, status: 'uncollectible', failedAttempts: PLANS.pro.maxAttempts });
    expect(env().gateway.callsForInvoice(renewalInvoiceId)).toHaveLength(PLANS.pro.maxAttempts);
    expect(final.statusHistory()).toEqual(['trialing', 'active', 'past_due', 'canceled']);
    await expectApiAndDbAgree(created.id);
  });

  it('webhook-driven: charge times out at signup, provider later confirms success by webhook', async () => {
    env().gateway.willTimeout({ captured: true });
    const created = await env().api.createOk(aSignupRequest().onProPlan().build());
    expect(created.status).toBe('trialing');
    expect(created.latest_invoice).toMatchObject({ status: 'open', failed_attempts: 0 });

    const [capturedCharge] = env().gateway.capturedCharges();
    const confirmation = env().webhooks.about(env().latestInvoiceId(created.id)).paymentSucceeded().withChargeId(capturedCharge!.providerChargeId);
    const receipt = await env().webhooks.send(confirmation);
    expect(receipt).toMatchObject({ status: 200, body: { outcome: 'processed' } });

    const final = env().stored(created.id);
    expect(final.status).toBe('active');
    expect(final.attempts).toEqual([expect.objectContaining({ status: 'succeeded', providerChargeId: capturedCharge!.providerChargeId })]);
    await expectApiAndDbAgree(created.id);
  });
});
