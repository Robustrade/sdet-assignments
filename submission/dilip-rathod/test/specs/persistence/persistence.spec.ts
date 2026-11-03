import { describe, expect, it } from 'vitest';
import { InvariantChecker } from '../../support/assertions/InvariantChecker';
import { useTestEnvironment } from '../../support/env/TestEnvironment';

describe('Persistence', () => {
  const env = useTestEnvironment();

  describe('records written per billing attempt', () => {
    it('each attempt is a row with amount, key, outcome source and timestamps; invoices carry plan and period', async () => {
      const { subscription, invoice } = await env().given.pastDue();
      env().clock.setTo(subscription.next_billing_at!);
      env().provider.willSucceed();
      await env().api.runBilling();

      const row = env().db.invoice(invoice.id)!;
      expect(row).toMatchObject({
        subscription_id: subscription.id,
        plan: 'pro',
        amount: 4900,
        currency: 'USD',
        status: 'paid',
        period_start: subscription.trial_ends_at,
        paid_at: env().clock.iso(),
      });
      const attempts = env().db.attemptsFor(invoice.id);
      expect(attempts).toHaveLength(2);
      expect(attempts.map((a) => [a.attempt_number, a.status, a.resolved_by])).toEqual([
        [1, 'declined', 'provider_response'],
        [2, 'succeeded', 'provider_response'],
      ]);
      expect(attempts[1].resolved_at).toBe(env().clock.iso());
      expect(attempts[0].created_at < attempts[1].created_at).toBe(true);
    });
  });

  describe('audit log', () => {
    it('records every lifecycle event in order, with its cause and reference', async () => {
      const { subscription, invoice } = await env().given.awaitingFirstChargeOutcome();
      await env().webhooks.deliverOk({
        event_id: 'evt_audit_1', type: 'payment.succeeded', subscription_id: subscription.id,
        invoice_id: invoice.id, amount: invoice.amount, currency: invoice.currency,
      });
      await env().api.changePlan(subscription.id, 'basic');
      await env().api.cancel(subscription.id);

      expect(env().db.auditTrail(subscription.id).map((e) => [e.event_type, e.from_status, e.to_status, e.cause, e.reference])).toEqual([
        ['created', null, 'trialing', 'api', null],
        ['status_changed', 'trialing', 'active', 'charge_succeeded', 'evt_audit_1'],
        ['plan_changed', 'active', 'active', 'api', null],
        ['status_changed', 'active', 'canceled', 'cancel_requested', null],
      ]);
    });
  });

  describe('schema-level guarantees (proved by bypassing the service)', () => {
    it('at most one open invoice per subscription', async () => {
      const { subscription } = await env().given.pastDue();
      expect(() =>
        env().db.unsafeExecute(
          `INSERT INTO invoices (id, subscription_id, plan, amount, currency, status, period_start, period_end, created_at)
           VALUES ('inv_second_open', ?, 'pro', 4900, 'USD', 'open', '2030-01-01', '2030-01-31', '2030-01-01')`,
          [subscription.id],
        ),
      ).toThrow(/UNIQUE constraint failed: invoices.subscription_id/);
    });

    it('payment attempt idempotency keys are unique', async () => {
      const { invoice } = await env().given.pastDue();
      expect(() =>
        env().db.unsafeExecute(
          `INSERT INTO payment_attempts (id, invoice_id, attempt_number, idempotency_key, amount, status, created_at)
           VALUES ('pa_dup', ?, 9, ?, 4900, 'pending', '2030-01-01')`,
          [invoice.id, `${invoice.id}:1`],
        ),
      ).toThrow(/UNIQUE constraint failed: payment_attempts.idempotency_key/);
    });

    it('a paid invoice must have paid_at; a canceled subscription must have canceled_at', async () => {
      const { subscription, invoice } = await env().given.pastDue();
      expect(() => env().db.unsafeExecute("UPDATE invoices SET status = 'paid' WHERE id = ?", [invoice.id])).toThrow(/CHECK constraint failed/);
      expect(() =>
        env().db.unsafeExecute("UPDATE subscriptions SET status = 'canceled', next_billing_at = NULL, cancel_reason = 'customer_request' WHERE id = ?", [subscription.id]),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  describe('the invariant checker catches contradictory records (testing the test)', () => {
    it('flags an active subscription whose only payment failed', async () => {
      const active = await env().given.active();
      const [invoice] = env().db.invoicesFor(active.id);
      // Simulate a corrupt write: the payment that justified "active" turns out to have been declined.
      env().db.unsafeExecute("UPDATE payment_attempts SET status = 'declined', decline_code = 'x' WHERE invoice_id = ?", [invoice.id]);

      const violations = await new InvariantChecker().violations(env().db, env().provider, env().api);

      expect(violations.join('\n')).toMatch(/active subscriptions have a successful, persisted payment/);
      expect(violations.join('\n')).toMatch(/no invoice is collected twice/);
      env().skipInvariantCheck();
    });

    it('flags an extra provider charge that has no attempt row (a charge the service did not record)', async () => {
      await env().given.active();
      await env().provider.charge({ customerId: 'c', paymentMethodId: 'pm', amount: 4900, currency: 'USD', idempotencyKey: 'rogue', reference: 'inv_x' });

      const violations = await new InvariantChecker().violations(env().db, env().provider, env().api);

      expect(violations.join('\n')).toMatch(/provider call rogue has no attempt row/);
      env().skipInvariantCheck();
    });

    it('flags an audit trail that does not end at the current status', async () => {
      const sub = await env().given.trialing();
      env().db.unsafeExecute("UPDATE subscriptions SET status = 'canceled', canceled_at = ?, cancel_reason = 'customer_request', next_billing_at = NULL WHERE id = ?", [env().clock.iso(), sub.id]);

      const violations = await new InvariantChecker().violations(env().db, env().provider, env().api);

      expect(violations.join('\n')).toMatch(/audit trail is a coherent chain.*trail ends at trialing/);
      env().skipInvariantCheck();
    });
  });
});
