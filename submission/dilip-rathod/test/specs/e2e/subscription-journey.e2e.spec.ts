import { describe, expect, it } from 'vitest';
import type { ExpectedSubscriptionState } from '../../support/assertions/expectations';
import { expectCharges, expectSubscriptionState } from '../../support/assertions/expectations';
import { aSubscriptionRequest, WebhookEventBuilder } from '../../support/builders/builders';
import type { TestEnvironment } from '../../support/env/TestEnvironment';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

/** Asserts API + DB + global invariants at a named point of the journey. */
async function checkpoint(env: TestEnvironment, label: string, id: string, expected: ExpectedSubscriptionState) {
  try {
    const sub = await expectSubscriptionState(env, id, expected);
    await env.verifyInvariants();
    return sub;
  } catch (error) {
    throw new Error(`Checkpoint "${label}" failed: ${(error as Error).message}`);
  }
}

describe('End to end: a pro subscription from sign-up to cancellation', () => {
  const env = useTestEnvironment({ startAt: '2026-03-01T12:00:00.000Z' });

  it('trial → async first payment → renewal decline → retry recovers → cancel → inert', async () => {
    const e = env();
    const customer = e.seed.customer();

    // 1. Sign up.
    const created = await e.api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());
    await checkpoint(e, 'signed up', created.id, { status: 'trialing', invoices: [] });

    // 2. Trial ends; provider accepts the charge asynchronously; webhook confirms (delivered twice).
    e.provider.willReturnPending();
    await e.given.billAt(created.trial_ends_at!);
    await checkpoint(e, 'first charge pending', created.id, { status: 'trialing', invoices: ['open'] });
    const firstInvoice = await e.given.latestInvoice(created.id);
    const confirmation = WebhookEventBuilder.paymentSucceeded(firstInvoice).with('charge_id', 'ch_mock_1').build();
    await e.webhooks.deliverOk(confirmation);
    await e.webhooks.deliverOk(confirmation);
    const active = await checkpoint(e, 'activated by webhook', created.id, { status: 'active', invoices: ['paid'] });
    expect(active.current_period_end).toBe('2026-04-14T12:00:00.000Z');

    // 3. Renewal is declined.
    e.provider.willDecline('insufficient_funds');
    await e.given.billAt(active.next_billing_at!);
    const pastDue = await checkpoint(e, 'renewal declined', created.id, { status: 'past_due', retryCount: 0, invoices: ['paid', 'open'] });

    // 4. First retry succeeds synchronously; a late duplicate failure webhook for that invoice is ignored.
    e.provider.willSucceed();
    await e.given.billAt(pastDue.next_billing_at!);
    const renewalInvoice = await e.given.latestInvoice(created.id);
    expect((await e.webhooks.deliverOk(WebhookEventBuilder.paymentFailed(renewalInvoice))).outcome).toBe('ignored');
    const recovered = await checkpoint(e, 'recovered', created.id, { status: 'active', retryCount: 0, invoices: ['paid', 'paid'] });
    expect(recovered.current_period_start).toBe(active.current_period_end);

    // 5. Customer cancels; nothing bills or reactivates afterwards.
    await e.api.cancel(created.id);
    e.clock.advanceDays(90);
    expect(await e.api.runBilling()).toEqual([]);
    expect((await e.webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(renewalInvoice))).outcome).toBe('ignored');
    await checkpoint(e, 'canceled', created.id, {
      status: 'canceled',
      invoices: ['paid', 'paid'],
      history: ['∅->trialing', 'trialing->active', 'active->past_due', 'past_due->active', 'active->canceled'],
    });

    // Provider saw exactly the three genuine billing attempts.
    expectCharges(e.provider, [
      { amount: 4900, idempotencyKey: `${firstInvoice.id}:1`, customerId: customer.id },
      { amount: 4900, idempotencyKey: `${renewalInvoice.id}:1` },
      { amount: 4900, idempotencyKey: `${renewalInvoice.id}:2` },
    ]);
    expect(e.db.notificationsFor(created.id).map((n) => n.kind)).toEqual([
      'subscription_activated',
      'payment_failed',
      'subscription_activated',
      'subscription_canceled',
    ]);
  });
});
