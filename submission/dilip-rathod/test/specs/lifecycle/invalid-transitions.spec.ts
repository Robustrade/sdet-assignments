import { describe, expect, it } from 'vitest';
import { expectError } from '../../support/api/HttpClient';
import { expectRowDeltas, expectSubscriptionState } from '../../support/assertions/expectations';
import { WebhookEventBuilder } from '../../support/builders/builders';
import type { TestEnvironment } from '../../support/env/TestEnvironment';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('Invalid transitions are impossible', () => {
  const env = useTestEnvironment();

  describe('canceled never transitions again', () => {
    it('a payment.succeeded for a charge that was in flight at cancellation does not reactivate', async () => {
      const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
      await env().api.cancel(subscription.id);
      const trailBefore = env().db.auditTrail(subscription.id);

      const ack = await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

      expect(ack).toMatchObject({ outcome: 'ignored', reason: 'invoice_not_open' });
      await expectSubscriptionState(env(), subscription.id, { status: 'canceled', invoices: ['void'] });
      expect(env().db.auditTrail(subscription.id)).toEqual(trailBefore);
      expect(env().db.notificationsFor(subscription.id).map((n) => n.kind)).not.toContain('subscription_activated');
    });

    it('a stray payment.succeeded after retries were exhausted does not reactivate', async () => {
      const { subscription, invoice } = await env().given.pastDue('basic');
      env().provider.alwaysRespond({ kind: 'decline', code: 'card_declined' });
      await env().given.billAt(subscription.next_billing_at!);
      await env().given.billAt((await env().api.get(subscription.id)).next_billing_at!);
      await expectSubscriptionState(env(), subscription.id, { status: 'canceled' });

      const ack = await env().webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

      expect(ack.outcome).toBe('ignored');
      await expectSubscriptionState(env(), subscription.id, { status: 'canceled', invoices: ['uncollectible'] });
    });

    it('a payment.failed after cancellation changes nothing', async () => {
      const { subscription, invoice } = await env().given.awaitingRenewalOutcome();
      await env().api.cancel(subscription.id);
      const before = env().db.subscription(subscription.id);

      expect((await env().webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice))).outcome).toBe('ignored');

      expect(env().db.subscription(subscription.id)).toEqual(before);
    });
  });

  describe('API calls outside the diagram are rejected with 409 and change nothing', () => {
    it.each([
      ['canceled', 'cancel'],
      ['past_due', 'cancel'],
    ] as const)('%s → %s', async (state, _action) => {
      const id = state === 'canceled' ? (await env().given.canceled()).id : (await env().given.pastDue()).subscription.id;
      const counts = env().db.counts();
      const row = env().db.subscription(id);

      expectError(await env().api.cancelSubscription(id), 409, 'invalid_transition');

      expect(env().db.subscription(id)).toEqual(row);
      expectRowDeltas(counts, env().db.counts());
    });
  });

  describe('the database itself refuses illegal status changes', () => {
    type Reach = (env: TestEnvironment) => Promise<string>;
    const reach: Record<string, Reach> = {
      active: async (e) => (await e.given.active()).id,
      past_due: async (e) => (await e.given.pastDue()).subscription.id,
      canceled: async (e) => (await e.given.canceled()).id,
    };

    // Every (from, to) pair that is not a diagram edge, with each `from` reached legitimately.
    it.each([
      ['active', 'trialing'],
      ['past_due', 'trialing'],
      ['canceled', 'trialing'],
      ['canceled', 'active'],
      ['canceled', 'past_due'],
    ])('raw UPDATE %s -> %s is aborted by the lifecycle trigger', async (from, to) => {
      const id = await reach[from](env());

      // Clear cancellation columns too, so it is the lifecycle trigger — not a CHECK — that fires.
      expect(() =>
        env().db.unsafeExecute('UPDATE subscriptions SET status = ?, canceled_at = NULL, cancel_reason = NULL WHERE id = ?', [to, id]),
      ).toThrow(/illegal subscription status transition/);
      expect(env().db.subscription(id)!.status).toBe(from);
    });

    it('raw INSERT of a subscription that skips trialing is aborted', async () => {
      const customer = env().seed.customer();
      expect(() =>
        env().db.unsafeExecute(
          `INSERT INTO subscriptions (id, customer_id, payment_method_id, plan, status, created_at, updated_at)
           VALUES ('sub_forged', ?, ?, 'pro', 'active', '2026-01-01', '2026-01-01')`,
          [customer.id, customer.paymentMethodIds[0]],
        ),
      ).toThrow(/must be created in the initial status/);
    });
  });
});
