import { describe, expect, it } from 'vitest';
import { SubscriptionRequestBuilder } from '../framework/builders/subscription-request-builder';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { ProviderAssertions } from '../framework/assertions/provider-assertions';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';

/**
 * LEVEL 4b — interaction with the mocked payment provider.
 *
 * This is the one dependency that moves money, so the assertions are about
 * *what* was sent and how often — never merely that "something was called".
 */
describe('Payment provider interaction', () => {
  const suite = useBillingSystem();

  it('sends the plan price, customer, payment method and a per-invoice idempotency key', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'pro' });
    suite.env.advanceDays(14);
    suite.env.provider.succeedsOnce();

    await suite.env.runBillingCycle();

    const invoice = await suite.env.latestInvoice(sub.id);
    ProviderAssertions.on(suite.env.provider).wasCalledTimes(1).lastChargeMatched({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amountCents: 4900,
      currency: 'USD',
      subscriptionId: sub.id,
      invoiceId: invoice.id,
      attempt: 1,
      idempotencyKey: `${sub.id}:${invoice.id}`
    });
  });

  it('charges once per billing attempt, however often the cycle runs', async () => {
    const sub = await suite.env.scenarios.active({ plan: 'pro' });
    const mark = suite.env.provider.mark();

    await suite.env.runBillingCycle();
    await suite.env.runBillingCycle();
    await suite.env.runBillingCycle();

    // Nothing is due until the period ends, so no further charge may be made.
    ProviderAssertions.on(suite.env.provider).wasNotCalledSince(mark);
    SubscriptionAssertions.for(suite.env, sub.id).hasInvoiceCount(1);
  });

  it('never charges for an action that does not require one', async () => {
    const trialing = await suite.env.scenarios.trialing();
    await suite.env.api.create(SubscriptionRequestBuilder.aRequest().onPlan('platinum').build());
    await suite.env.api.cancel(trialing.id);

    // A canceled subscription is never billed again, however far time moves.
    suite.env.advanceDays(90);
    await suite.env.runBillingCycle();

    ProviderAssertions.on(suite.env.provider).wasNeverCalled();
    await SubscriptionAssertions.for(suite.env, trialing.id).hasState('canceled');
  });

  it('declined: moves to past_due, records the decline code, and writes no success record', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'pro' });
    suite.env.advanceDays(14);
    suite.env.provider.declinesOnce('insufficient_funds');

    await suite.env.runBillingCycle();

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    const invoice = await suite.env.latestInvoice(sub.id);
    expect(invoice.status).toBe('failed');
    expect(invoice.failure_code).toBe('insufficient_funds');
    expect(invoice.paid_at).toBeNull();
    expect(invoice.provider_charge_id).toBeNull();
    SubscriptionAssertions.for(suite.env, sub.id).hasPaidInvoiceCount(0);
  });

  it('timeout: leaves the outcome unresolved, does not re-charge, and voids the invoice if cancelled', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'pro' });
    suite.env.advanceDays(14);
    suite.env.provider.timesOutOnce();

    await suite.env.runBillingCycle();

    // A timeout is ambiguous: the charge may have succeeded upstream, so the
    // service must neither claim success nor declare failure.
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('trialing');
    expect((await suite.env.latestInvoice(sub.id)).status).toBe('pending');
    SubscriptionAssertions.for(suite.env, sub.id).hasNoTransitionsAfter(0);
    expect(
      suite.env.repos.subscriptionEvents.findBySubscription(sub.id).map((e) => e.note)
    ).toContain('charge_attempt_timed_out');

    // Re-running the cycle must not double-charge while the outcome is unknown.
    const mark = suite.env.provider.mark();
    await suite.env.runBillingCycle();
    ProviderAssertions.on(suite.env.provider).wasNotCalledSince(mark);
    SubscriptionAssertions.for(suite.env, sub.id).hasInvoiceCount(1);

    // Cancelling stops future billing: the open invoice is voided, not charged.
    await suite.env.api.cancel(sub.id);
    SubscriptionAssertions.for(suite.env, sub.id).hasInvoiceStatuses('void');
    expect(
      suite.env.repos.subscriptionEvents.findBySubscription(sub.id).map((e) => e.note)
    ).toContain('invoice_voided');
  });

  it('gives every retry its own invoice and its own idempotency key', async () => {
    const sub = await suite.env.scenarios.pastDue({ plan: 'basic' });
    suite.env.advanceDays(3);
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();
    suite.env.advanceDays(3);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();

    const invoices = await suite.env.invoicesOf(sub.id);
    expect(invoices.map((i) => i.attempt)).toEqual([1, 2, 3]);
    ProviderAssertions.on(suite.env.provider)
      .wasCalledTimesForSubscription(sub.id, 3)
      .usedUniqueIdempotencyKeys()
      .chargeAtMatched(0, { invoiceId: invoices[0].id, attempt: 1 })
      .chargeAtMatched(2, { invoiceId: invoices[2].id, attempt: 3 });
    expect(suite.env.provider.idempotencyKeys()).toEqual(invoices.map((i) => `${sub.id}:${i.id}`));
  });
});
