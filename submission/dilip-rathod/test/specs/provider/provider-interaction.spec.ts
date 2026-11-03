import { describe, expect, it } from 'vitest';
import { expectCharges, expectNoCharges, expectSubscriptionState } from '../../support/assertions/expectations';
import { aSubscriptionRequest, WebhookEventBuilder } from '../../support/builders/builders';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('Payment provider interaction (mocked)', () => {
  const env = useTestEnvironment();

  describe('what is sent', () => {
    it('the first charge after trial carries customer, payment method, plan price, currency and a per-attempt idempotency key', async () => {
      const customer = env().seed.customer();
      const sub = await env().api.create(aSubscriptionRequest().forCustomer(customer).onPlan('pro').build());

      await env().given.billAt(sub.trial_ends_at!);

      const [invoice] = await env().api.invoices(sub.id);
      expect(env().provider.charge).toHaveBeenCalledTimes(1);
      expect(env().provider.charge).toHaveBeenCalledWith({
        customerId: customer.id,
        paymentMethodId: customer.paymentMethodIds[0],
        amount: 4900,
        currency: 'USD',
        idempotencyKey: `${invoice.id}:1`,
        reference: invoice.id,
      });
    });

    it('a retry is a new attempt on the same invoice: same amount and reference, new idempotency key', async () => {
      const { subscription, invoice } = await env().given.pastDue();

      await env().given.billAt(subscription.next_billing_at!);

      expectCharges(env().provider, [
        { reference: invoice.id, amount: 4900, idempotencyKey: `${invoice.id}:1` },
        { reference: invoice.id, amount: 4900, idempotencyKey: `${invoice.id}:2` },
      ]);
    });

    it('a renewal is a new invoice with its own idempotency key', async () => {
      const active = await env().given.active();

      await env().given.billAt(active.next_billing_at!);

      const [first, second] = await env().api.invoices(active.id);
      expectCharges(env().provider, [{ idempotencyKey: `${first.id}:1` }, { idempotencyKey: `${second.id}:1` }]);
    });
  });

  describe('when it is not called', () => {
    it('not for a trial plan at creation, nor for reads, nor before anything is due', async () => {
      const sub = await env().given.trialing();
      await env().api.get(sub.id);
      await env().api.invoices(sub.id);
      env().clock.advanceDays(13);
      expect(await env().api.runBilling()).toEqual([]);
      expectNoCharges(env().provider);
    });

    it('not for rejected creations', async () => {
      const customer = env().seed.customer();
      await env().api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').without('payment_method_id').build());
      await env().api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('gold').build());
      await env().api.createSubscription(aSubscriptionRequest().forCustomer(customer).onPlan('basic').withPaymentMethod('pm_stolen').build());
      expectNoCharges(env().provider);
    });

    it('not for webhooks, replayed or otherwise', async () => {
      const { invoice } = await env().given.awaitingFirstChargeOutcome();
      const event = WebhookEventBuilder.paymentSucceeded(invoice).build();
      await env().webhooks.deliverOk(event);
      await env().webhooks.deliverOk(event);
      await env().webhooks.deliverOk(WebhookEventBuilder.paymentRefunded(invoice));
      expect(env().provider.callCount).toBe(1); // the original charge only
    });

    it('not twice when the billing job runs twice at the same instant', async () => {
      const sub = await env().given.trialing();
      env().clock.setTo(sub.trial_ends_at!);
      await env().api.runBilling();
      await env().api.runBilling();
      expect(env().provider.callCount).toBe(1);
    });

    it('not for cancellation', async () => {
      const active = await env().given.active();
      await env().api.cancel(active.id);
      expect(env().provider.callCount).toBe(1);
    });
  });

  describe('how each provider outcome is handled', () => {
    it('success → active with a succeeded attempt and paid invoice', async () => {
      const sub = await env().given.trialing();
      env().provider.willSucceed();
      expect(await env().given.billAt(sub.trial_ends_at!)).toMatchObject([{ outcome: 'succeeded' }]);
      await expectSubscriptionState(env(), sub.id, { status: 'active', invoices: ['paid'] });
    });

    it('decline → past_due, failure recorded, no success record anywhere', async () => {
      const sub = await env().given.trialing();
      env().provider.willDecline('insufficient_funds');

      expect(await env().given.billAt(sub.trial_ends_at!)).toMatchObject([{ outcome: 'declined' }]);

      await expectSubscriptionState(env(), sub.id, { status: 'past_due', invoices: ['open'] });
      const attempts = env().db.attemptsForSubscription(sub.id);
      expect(attempts).toMatchObject([{ status: 'declined', decline_code: 'insufficient_funds' }]);
      expect(env().db.invoicesFor(sub.id).every((i) => i.paid_at === null)).toBe(true);
    });

    it('timeout → no state change, no blind retry, resolved later by webhook', async () => {
      const sub = await env().given.trialing();
      env().provider.willTimeout();

      expect(await env().given.billAt(sub.trial_ends_at!)).toMatchObject([{ outcome: 'timed_out' }]);

      await expectSubscriptionState(env(), sub.id, { status: 'trialing', invoices: ['open'] });
      const [invoice] = await env().api.invoices(sub.id);
      expect(env().db.attemptsFor(invoice.id)).toMatchObject([{ status: 'timed_out', resolved_at: null }]);

      // The outcome is unknown, so the next run must not charge again.
      env().clock.advanceDays(1);
      expect(await env().api.runBilling()).toMatchObject([{ outcome: 'skipped_charge_in_flight' }]);
      expect(env().provider.callCount).toBe(1);

      await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));
      await expectSubscriptionState(env(), sub.id, { status: 'active', invoices: ['paid'] });
      expect(env().db.attemptsFor(invoice.id)).toMatchObject([{ status: 'succeeded', resolved_by: 'webhook' }]);
    });

    it('timeout at creation of a no-trial plan → 201 trialing with the charge outstanding', async () => {
      env().provider.willTimeout();
      const sub = await env().api.create(aSubscriptionRequest().forCustomer(env().seed.customer()).onPlan('basic').build());
      expect(sub).toMatchObject({ status: 'trialing', latest_invoice: { status: 'open', amount: 1900 } });
    });

    it('pending → no state change until the webhook decides', async () => {
      const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
      expect(env().db.attemptsFor(invoice.id)).toMatchObject([{ status: 'pending', provider_charge_id: 'ch_mock_1' }]);
      await expectSubscriptionState(env(), subscription.id, { status: 'trialing', invoices: ['open'] });
    });
  });
});
