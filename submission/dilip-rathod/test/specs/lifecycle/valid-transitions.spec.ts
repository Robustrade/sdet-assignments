import { describe, expect, it } from 'vitest';
import { expectCharges, expectSubscriptionState } from '../../support/assertions/expectations';
import { WebhookEventBuilder } from '../../support/builders/builders';
import type { TestEnvironment } from '../../support/env/TestEnvironment';
import { useTestEnvironment } from '../../support/env/TestEnvironment';
import { DIAGRAM_EDGES } from './diagram';
import type { DiagramEdge } from './diagram';

interface TransitionScenario {
  edge: DiagramEdge;
  via: string;
  run(env: TestEnvironment): Promise<void>;
}

const addDays = (instant: string, days: number) => new Date(new Date(instant).getTime() + days * 86_400_000).toISOString();

/**
 * One entry per (edge, trigger source). Each drives the edge through the public surface and
 * asserts the persisted consequences, not only the status.
 */
const scenarios: TransitionScenario[] = [
  {
    edge: 'trialing->active',
    via: 'billing job at trial end, provider succeeds',
    async run(env) {
      const sub = await env.given.trialing();
      env.provider.willSucceed();

      await env.given.billAt(sub.trial_ends_at!);

      const after = await expectSubscriptionState(env, sub.id, { status: 'active', invoices: ['paid'], history: ['∅->trialing', 'trialing->active'] });
      expect(after).toMatchObject({
        current_period_start: sub.trial_ends_at,
        current_period_end: addDays(sub.trial_ends_at!, 30),
        next_billing_at: addDays(sub.trial_ends_at!, 30),
      });
      expect(env.db.attemptsForSubscription(sub.id)).toMatchObject([{ status: 'succeeded', resolved_by: 'provider_response', provider_charge_id: 'ch_mock_1' }]);
      expect(env.db.notificationsFor(sub.id).map((n) => n.kind)).toEqual(['subscription_activated']);
    },
  },
  {
    edge: 'trialing->active',
    via: 'payment.succeeded webhook for a pending first charge',
    async run(env) {
      const { subscription, invoice } = await env.given.awaitingFirstChargeOutcome();

      const ack = await env.webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice).with('charge_id', 'ch_mock_1'));

      expect(ack.outcome).toBe('applied');
      await expectSubscriptionState(env, subscription.id, { status: 'active', invoices: ['paid'] });
      expect(env.db.attemptsFor(invoice.id)).toMatchObject([{ status: 'succeeded', resolved_by: 'webhook' }]);
    },
  },
  {
    edge: 'trialing->past_due',
    via: 'billing job at trial end, provider declines',
    async run(env) {
      const sub = await env.given.trialing();
      env.provider.willDecline('expired_card');

      await env.given.billAt(sub.trial_ends_at!);

      const after = await expectSubscriptionState(env, sub.id, { status: 'past_due', retryCount: 0, invoices: ['open'] });
      expect(after.next_billing_at).toBe(addDays(sub.trial_ends_at!, 3));
      expect(after.current_period_start).toBeNull();
      expect(env.db.attemptsForSubscription(sub.id)).toMatchObject([{ status: 'declined', decline_code: 'expired_card' }]);
      expect(env.db.notificationsFor(sub.id).map((n) => n.kind)).toEqual(['payment_failed']);
    },
  },
  {
    edge: 'trialing->past_due',
    via: 'payment.failed webhook for a pending first charge',
    async run(env) {
      const { subscription, invoice } = await env.given.awaitingFirstChargeOutcome();

      await env.webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice).withFailureCode('do_not_honor'));

      await expectSubscriptionState(env, subscription.id, { status: 'past_due', invoices: ['open'] });
      expect(env.db.attemptsFor(invoice.id)).toMatchObject([{ status: 'declined', decline_code: 'do_not_honor', resolved_by: 'webhook' }]);
    },
  },
  {
    edge: 'active->past_due',
    via: 'billing job at renewal, provider declines',
    async run(env) {
      const active = await env.given.active();
      env.provider.willDecline();

      await env.given.billAt(active.next_billing_at!);

      await expectSubscriptionState(env, active.id, { status: 'past_due', invoices: ['paid', 'open'], history: ['∅->trialing', 'trialing->active', 'active->past_due'] });
      expectCharges(env.provider, [{ amount: 4900 }, { amount: 4900 }]);
    },
  },
  {
    edge: 'active->past_due',
    via: 'payment.failed webhook for a pending renewal',
    async run(env) {
      const { subscription, invoice } = await env.given.awaitingRenewalOutcome();

      await env.webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice));

      await expectSubscriptionState(env, subscription.id, { status: 'past_due', invoices: ['paid', 'open'] });
    },
  },
  {
    edge: 'past_due->active',
    via: 'billing job at retry date, provider succeeds',
    async run(env) {
      const { subscription, invoice } = await env.given.pastDue();
      env.provider.willSucceed();

      await env.given.billAt(subscription.next_billing_at!);

      const after = await expectSubscriptionState(env, subscription.id, { status: 'active', retryCount: 0, invoices: ['paid'] });
      // The retry pays the same invoice; the period starts where the trial ended, not at the retry date.
      expect(after.current_period_start).toBe(subscription.trial_ends_at);
      expect(env.db.attemptsFor(invoice.id).map((a) => [a.idempotency_key, a.status])).toEqual([
        [`${invoice.id}:1`, 'declined'],
        [`${invoice.id}:2`, 'succeeded'],
      ]);
    },
  },
  {
    edge: 'past_due->active',
    via: 'payment.succeeded webhook for a pending retry',
    async run(env) {
      const { subscription, invoice } = await env.given.awaitingRetryOutcome();

      await env.webhooks.deliverOk(WebhookEventBuilder.paymentSucceeded(invoice));

      await expectSubscriptionState(env, subscription.id, { status: 'active', invoices: ['paid'] });
    },
  },
  {
    edge: 'past_due->canceled',
    via: 'retries exhausted on pro (3 retries)',
    async run(env) {
      const { subscription, invoice } = await env.given.pastDue('pro');
      env.provider.alwaysRespond({ kind: 'decline', code: 'card_declined' });

      for (const expectedRetryCount of [1, 2]) {
        await env.given.billAt((await env.api.get(subscription.id)).next_billing_at!);
        await expectSubscriptionState(env, subscription.id, { status: 'past_due', retryCount: expectedRetryCount });
      }
      await env.given.billAt((await env.api.get(subscription.id)).next_billing_at!);

      const after = await expectSubscriptionState(env, subscription.id, { status: 'canceled', retryCount: 3, invoices: ['uncollectible'] });
      expect(after).toMatchObject({ cancel_reason: 'retries_exhausted', next_billing_at: null });
      expect(env.db.attemptsFor(invoice.id)).toHaveLength(4);
      expect(env.db.auditTrail(subscription.id).map((e) => e.event_type)).toEqual([
        'created', 'status_changed', 'retry_failed', 'retry_failed', 'status_changed',
      ]);
    },
  },
  {
    edge: 'past_due->canceled',
    via: 'retries exhausted on basic (2 retries), final failure by webhook',
    async run(env) {
      const { subscription, invoice } = await env.given.pastDue('basic');
      env.provider.willDecline();
      await env.given.billAt(subscription.next_billing_at!);
      await expectSubscriptionState(env, subscription.id, { status: 'past_due', retryCount: 1 });

      env.provider.willReturnPending();
      await env.given.billAt((await env.api.get(subscription.id)).next_billing_at!);
      await env.webhooks.deliverOk(WebhookEventBuilder.paymentFailed(invoice));

      await expectSubscriptionState(env, subscription.id, { status: 'canceled', retryCount: 2, invoices: ['uncollectible'] });
      expect(env.db.attemptsFor(invoice.id).map((a) => a.resolved_by)).toEqual(['provider_response', 'provider_response', 'webhook']);
    },
  },
  {
    edge: 'active->canceled',
    via: 'POST /cancel',
    async run(env) {
      const active = await env.given.active();

      await env.api.cancel(active.id);

      await expectSubscriptionState(env, active.id, { status: 'canceled', invoices: ['paid'], history: ['∅->trialing', 'trialing->active', 'active->canceled'] });
    },
  },
  {
    edge: 'trialing->canceled',
    via: 'POST /cancel',
    async run(env) {
      const sub = await env.given.trialing();

      await env.api.cancel(sub.id);

      await expectSubscriptionState(env, sub.id, { status: 'canceled', invoices: [], history: ['∅->trialing', 'trialing->canceled'] });
    },
  },
];

describe('Lifecycle — every diagram edge, driven through the API, billing job and webhooks', () => {
  const env = useTestEnvironment();

  it.each(scenarios)('$edge via $via', async ({ run }) => {
    await run(env());
  });

  it('every edge of the diagram has at least one scenario, and every scenario is a diagram edge', () => {
    expect(new Set(scenarios.map((s) => s.edge))).toEqual(new Set(DIAGRAM_EDGES));
  });
});

describe('Lifecycle — status-preserving triggers', () => {
  const env = useTestEnvironment();

  it('a successful renewal keeps the subscription active and starts the next period where the last ended', async () => {
    const active = await env().given.active();
    env().provider.willSucceed(2);

    await env().given.billAt(active.next_billing_at!);
    const renewed = await env().api.get(active.id);
    await env().given.billAt(renewed.next_billing_at!);

    await expectSubscriptionState(env(), active.id, { status: 'active', invoices: ['paid', 'paid', 'paid'], history: ['∅->trialing', 'trialing->active'] });
    const periods = env().db.invoicesFor(active.id).map((i) => [i.period_start, i.period_end]);
    for (let i = 1; i < periods.length; i++) expect(periods[i][0]).toBe(periods[i - 1][1]);
    expect(env().db.auditTrail(active.id).filter((e) => e.event_type === 'renewed')).toHaveLength(2);
    // Renewals don't re-send the activation email.
    expect(env().db.notificationsFor(active.id).map((n) => n.kind)).toEqual(['subscription_activated']);
  });

  it('a failed retry keeps the subscription past_due, increments retry_count and reschedules', async () => {
    const { subscription } = await env().given.pastDue();
    env().provider.willDecline();

    await env().given.billAt(subscription.next_billing_at!);

    const after = await expectSubscriptionState(env(), subscription.id, { status: 'past_due', retryCount: 1, invoices: ['open'] });
    expect(after.next_billing_at).toBe(addDays(subscription.next_billing_at!, 3));
  });
});
