import { describe, expect, it } from 'vitest';
import { expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { WebhookEventBuilder } from '../../support/builders/builders';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('Out-of-order, stale and mismatched webhooks', () => {
  const env = useTestEnvironment();

  it('payment.failed arriving after payment.succeeded for the same invoice does not regress an active subscription', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
    await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

    const late = await env().webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice));

    expect(late).toMatchObject({ outcome: 'ignored', reason: 'invoice_not_open' });
    await expectSubscriptionState(env(), subscription.id, { status: 'active', retryCount: 0, invoices: ['paid'] });
    expect(env().db.attemptsFor(invoice.id)).toMatchObject([{ status: 'succeeded' }]);
    expect(env().db.notificationsFor(subscription.id).map((n) => n.kind)).toEqual(['subscription_activated']);
  });

  it('payment.failed after a synchronous success (no webhook ever applied) does not regress', async () => {
    const active = await env().given.active();
    const invoice = await env().given.latestInvoice(active.id);

    expect((await env().webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice))).outcome).toBe('ignored');

    await expectSubscriptionState(env(), active.id, { status: 'active', invoices: ['paid'] });
  });

  it('a payment.succeeded contradicting an already-recorded decline does not flip the outcome', async () => {
    const { subscription, invoice } = await env().given.pastDue();

    const ack = await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

    expect(ack).toMatchObject({ outcome: 'ignored', reason: 'no_pending_attempt' });
    await expectSubscriptionState(env(), subscription.id, { status: 'past_due', invoices: ['open'] });
  });

  it('a stale payment.failed for last period’s paid invoice does not touch the current period', async () => {
    const { subscription, invoice: renewal } = await env().given.awaitingRenewalOutcome();
    const [previous] = await env().api.invoices(subscription.id);
    expect(previous.status).toBe('paid');

    expect((await env().webhooks.deliverOk(WebhookEventBuilder.paymentFailed(previous))).outcome).toBe('ignored');
    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid', 'open'] });

    // The current period still resolves normally afterwards.
    await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(renewal));
    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid', 'paid'] });
  });

  it('a refund that arrives before the payment it refunds is ignored, and the payment still applies', async () => {
    const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();

    const early = await env().webhooks.deliverOk(WebhookEventBuilder.paymentRefunded(invoice));
    expect(early).toMatchObject({ outcome: 'ignored', reason: 'invoice_not_paid' });

    await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));
    await expectSubscriptionState(env(), subscription.id, { status: 'active', invoices: ['paid'] });
  });

  it('a refund leaves the subscription status unchanged (not a lifecycle edge)', async () => {
    const active = await env().given.active();
    await env().webhooks.deliverOk(WebhookEventBuilder.paymentRefunded(await env().given.latestInvoice(active.id)));
    await expectSubscriptionState(env(), active.id, { status: 'active', invoices: ['refunded'] });
  });

  describe('events that do not match our records are acknowledged and ignored without side effects', () => {
    it.each([
      ['subscription_mismatch', (e: WebhookEventBuilder) => e.withSubscriptionId('sub_someone_else')],
      ['amount_mismatch', (e: WebhookEventBuilder) => e.withAmount(1)],
      ['amount_mismatch', (e: WebhookEventBuilder) => e.with('currency', 'EUR')],
      ['unknown_invoice', (e: WebhookEventBuilder) => e.withInvoiceId('inv_unknown')],
    ])('%s', async (reason, mutate) => {
      const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
      const before = env().db.counts();

      const ack = await env().webhooks.deliverOk(mutate(WebhookEventBuilder.paymentSucceeded(invoice)));

      expect(ack).toMatchObject({ outcome: 'ignored', reason });
      expectRowDeltas(before, env().db.counts(), { webhook_events: 1, webhook_deliveries: 1 });
      await expectSubscriptionState(env(), subscription.id, { status: 'trialing', invoices: ['open'] });
    });
  });

  describe('webhook racing the synchronous provider response (bonus: concurrency)', () => {
    it('webhook success lands while the charge call is in flight; the late decline response is discarded', async () => {
      const sub = await env().given.trialing();
      env().clock.setTo(sub.trial_ends_at!);
      const held = env().provider.holdNextCharge();

      const billing = env().api.runBilling();
      const request = await held.called;
      const ack = await env().webhooks.deliverOk(
        WebhookEventBuilder.paymentSucceeded({ id: request.reference, subscription_id: sub.id, amount: request.amount, currency: request.currency }),
      );
      held.respondWith({ kind: 'decline', code: 'card_declined' });
      const [result] = await billing;

      expect(ack.outcome).toBe('applied');
      expect(result.outcome).toBe('resolved_elsewhere');
      await expectSubscriptionState(env(), sub.id, { status: 'active', invoices: ['paid'] });
      expect(env().db.attemptsFor(request.reference)).toMatchObject([{ status: 'succeeded', resolved_by: 'webhook' }]);
    });

    it.each([
      ['succeed', { kind: 'succeed' }],
      ['decline', { kind: 'decline', code: 'card_declined' }],
    ] as const)('cancellation lands while the charge is in flight; the late %s response cannot move it', async (_label, outcome) => {
      const sub = await env().given.trialing();
      env().clock.setTo(sub.trial_ends_at!);
      const held = env().provider.holdNextCharge();

      const billing = env().api.runBilling();
      await held.called;
      await env().api.cancel(sub.id);
      held.respondWith(outcome);
      const [result] = await billing;

      expect(result.outcome).toBe('ignored');
      await expectSubscriptionState(env(), sub.id, { status: 'canceled', invoices: ['void'], history: ['∅->trialing', 'trialing->canceled'] });
    });

    it('a billing run while a charge is in flight does not charge again', async () => {
      const sub = await env().given.trialing();
      env().clock.setTo(sub.trial_ends_at!);
      const held = env().provider.holdNextCharge();

      const first = env().api.runBilling();
      await held.called;
      const second = await env().api.runBilling();
      held.respondWith({ kind: 'succeed' });
      await first;

      expect(second).toMatchObject([{ outcome: 'skipped_charge_in_flight' }]);
      expect(env().provider.callCount).toBe(1);
      await expectSubscriptionState(env(), sub.id, { status: 'active' });
    });
  });
});
