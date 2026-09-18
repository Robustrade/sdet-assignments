import { describe, expect, it } from 'vitest';
import {
  SubscriptionStateMachine,
  TRANSITION_TABLE,
  type LifecycleTrigger
} from '../../src/domain/subscription-state-machine';
import { SUBSCRIPTION_STATES, type SubscriptionState } from '../../src/domain/types';
import { WebhookEventBuilder } from '../framework/builders/webhook-event-builder';
import { SubscriptionAssertions } from '../framework/assertions/subscription-assertions';
import { useBillingSystem } from '../framework/harness/suite';
import type { TestEnvironment } from '../framework/harness/test-environment';

/**
 * LEVEL 2 — state machine / workflow.
 *
 * The integration tests are journeys rather than one test per edge: a journey is
 * how the lifecycle is actually lived, and the final test proves the journeys
 * between them exercised every edge the table declares.
 */
const exercisedTransitions = new Set<string>();

function recordCoverage(env: TestEnvironment): void {
  for (const event of env.repos.subscriptionEvents.all()) {
    if (event.kind === 'transition' && event.transition_id) exercisedTransitions.add(event.transition_id);
  }
}

describe('Subscription state machine (unit)', () => {
  const machine = new SubscriptionStateMachine();

  it('treats canceled as terminal: no trigger has an outgoing edge', () => {
    expect(machine.isTerminal('canceled')).toBe(true);
    const triggers: LifecycleTrigger[] = [
      'trial_charge_succeeded',
      'trial_charge_failed',
      'charge_succeeded',
      'charge_failed',
      'cancel_requested'
    ];
    for (const trigger of triggers) {
      const result = machine.transition('canceled', trigger, { retriesRemaining: 5 });
      expect(result.ok, `canceled must not accept ${trigger}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('TERMINAL_STATE');
    }
  });

  it('rejects (state, trigger) pairs the lifecycle does not declare', () => {
    const illegal: Array<[SubscriptionState, LifecycleTrigger]> = [
      ['trialing', 'charge_succeeded'],
      ['trialing', 'charge_failed'],
      ['active', 'trial_charge_succeeded'],
      ['active', 'trial_charge_failed'],
      ['past_due', 'cancel_requested'],
      ['past_due', 'trial_charge_succeeded']
    ];
    for (const [from, trigger] of illegal) {
      const result = machine.transition(from, trigger, { retriesRemaining: 2 });
      expect(result.ok, `${from} + ${trigger}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('ILLEGAL_TRANSITION');
    }
  });

  it('is a well-formed table: known states, all reachable, and no ambiguous edge', () => {
    for (const definition of TRANSITION_TABLE) {
      expect(SUBSCRIPTION_STATES).toContain(definition.from);
      expect(SUBSCRIPTION_STATES).toContain(definition.to);
    }

    const reachable = new Set<SubscriptionState>(['trialing']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of TRANSITION_TABLE) {
        if (reachable.has(t.from) && !reachable.has(t.to)) {
          reachable.add(t.to);
          grew = true;
        }
      }
    }
    expect([...reachable].sort()).toEqual([...SUBSCRIPTION_STATES].sort());

    const contexts = [{ retriesRemaining: 0 }, { retriesRemaining: 1 }, { retriesRemaining: 5 }];
    for (const state of SUBSCRIPTION_STATES) {
      for (const trigger of new Set(TRANSITION_TABLE.map((t) => t.trigger))) {
        for (const ctx of contexts) {
          const matches = TRANSITION_TABLE.filter(
            (t) => t.from === state && t.trigger === trigger && (t.guard ? t.guard(ctx) : true)
          );
          expect(matches.length, `${state} + ${trigger} @ ${JSON.stringify(ctx)}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('resolves the two guarded past_due edges by remaining retry budget', () => {
    expect(machine.transition('past_due', 'charge_failed', { retriesRemaining: 2 })).toMatchObject({
      ok: true,
      to: 'past_due',
      id: 'PAST_DUE_RETRY_FAILED_AGAIN'
    });
    expect(machine.transition('past_due', 'charge_failed', { retriesRemaining: 1 })).toMatchObject({
      ok: true,
      to: 'canceled',
      id: 'PAST_DUE_RETRIES_EXHAUSTED'
    });
  });
});

describe('Subscription lifecycle (integration)', () => {
  const suite = useBillingSystem();

  it('trial converts, renews, then is cancelled by the customer', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'pro' });

    suite.env.advanceDays(14); // trial ends
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');

    suite.env.advanceDays(30); // renewal
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');

    await suite.env.api.cancel(sub.id);

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail(
        'TRIAL_ENDS_CHARGE_SUCCEEDED',
        'ACTIVE_RENEWAL_SUCCEEDED',
        'ACTIVE_CANCELED_BY_API'
      )
      .hasPaidInvoiceCount(2);
    recordCoverage(suite.env);
  });

  it('is cancelled during the trial, before any money moves', async () => {
    const sub = await suite.env.scenarios.trialing();

    await suite.env.api.cancel(sub.id);

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_CANCELED_BY_API')
      .hasNoInvoices();
    expect(suite.env.provider.callCount).toBe(0);
    recordCoverage(suite.env);
  });

  it('fails its first charge, recovers on retry, then fails a later renewal', async () => {
    const sub = await suite.env.scenarios.trialing({ plan: 'basic' });

    suite.env.advanceDays(7); // trial ends, declined
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');

    suite.env.advanceDays(3); // scheduled retry succeeds
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');

    suite.env.advanceDays(30); // renewal declined
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail(
        'TRIAL_ENDS_CHARGE_FAILED',
        'PAST_DUE_RETRY_SUCCEEDED',
        'ACTIVE_CHARGE_FAILED'
      )
      .hasInvoiceStatuses('failed', 'paid', 'failed');
    recordCoverage(suite.env);
  });

  it('is cancelled by the system once the retry budget is exhausted', async () => {
    // basic allows 2 retries after entering past_due.
    const sub = await suite.env.scenarios.pastDue({ plan: 'basic' });
    expect(suite.env.repos.subscriptions.requireById(sub.id).retries_remaining).toBe(2);

    suite.env.advanceDays(3);
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    expect(suite.env.repos.subscriptions.requireById(sub.id).retries_remaining).toBe(1);

    suite.env.advanceDays(3);
    suite.env.provider.declinesOnce();
    await suite.env.runBillingCycle();

    await SubscriptionAssertions.for(suite.env, sub.id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail(
        'TRIAL_ENDS_CHARGE_FAILED',
        'PAST_DUE_RETRY_FAILED_AGAIN',
        'PAST_DUE_RETRIES_EXHAUSTED'
      )
      .hasPaidInvoiceCount(0);
    recordCoverage(suite.env);
  });

  it('cannot be revived by any webhook once it is canceled', async () => {
    const sub = await suite.env.scenarios.active();
    const invoice = await suite.env.latestInvoice(sub.id);
    await suite.env.api.cancel(sub.id);

    const success = WebhookEventBuilder.anEvent().succeeded().forInvoice(invoice).build();
    const failure = WebhookEventBuilder.anEvent().failed().forInvoice(invoice).build();
    const successResponse = await suite.env.webhooks.deliver(success);
    const failureResponse = await suite.env.webhooks.deliver(failure);

    expect(successResponse.body).toMatchObject({ status: 'ignored', reason: 'SUBSCRIPTION_CANCELED' });
    expect(failureResponse.body).toMatchObject({ status: 'ignored', reason: 'SUBSCRIPTION_CANCELED' });
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('canceled');
    SubscriptionAssertions.for(suite.env, sub.id)
      .hasTransitionTrail('TRIAL_ENDS_CHARGE_SUCCEEDED', 'ACTIVE_CANCELED_BY_API')
      .hasWebhookEventRecorded(success.event_id, 'ignored', 'SUBSCRIPTION_CANCELED');
    recordCoverage(suite.env);
  });

  it('cannot be cancelled from past_due: the lifecycle declares no such edge', async () => {
    const sub = await suite.env.scenarios.pastDue({ plan: 'basic' });

    const response = await suite.env.api.cancel(sub.id);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ILLEGAL_TRANSITION');
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('past_due');
    recordCoverage(suite.env);
  });

  it('does not regress when a failure webhook arrives after the invoice was paid', async () => {
    const sub = await suite.env.scenarios.active();
    const invoice = await suite.env.latestInvoice(sub.id);

    const payload = WebhookEventBuilder.anEvent().failed().forInvoice(invoice).build();
    const response = await suite.env.webhooks.deliver(payload);

    expect(response.body).toMatchObject({
      status: 'ignored',
      reason: 'STALE_EVENT_INVOICE_ALREADY_PAID'
    });
    await SubscriptionAssertions.for(suite.env, sub.id).hasState('active');
    SubscriptionAssertions.for(suite.env, sub.id).hasInvoiceStatuses('paid').hasNoTransitionsAfter(1);
    recordCoverage(suite.env);
  });

  it('applies each plan trial length and price at creation and at billing', async () => {
    const basic = await suite.env.scenarios.trialing({ plan: 'basic' });
    const pro = await suite.env.scenarios.trialing({
      plan: 'pro',
      customerId: 'cust_002',
      paymentMethodId: 'pm_test_mastercard_5555'
    });

    expect(basic.trial_ends_at, '7 day trial').toBe('2026-01-08T00:00:00.000Z');
    expect(pro.trial_ends_at, '14 day trial').toBe('2026-01-15T00:00:00.000Z');

    suite.env.advanceDays(7);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();

    // Only basic is due on day 7; pro must not be billed early.
    await SubscriptionAssertions.for(suite.env, basic.id).hasState('active');
    await SubscriptionAssertions.for(suite.env, pro.id).hasState('trialing');
    expect(suite.env.provider.callCount).toBe(1);
    expect(suite.env.provider.lastCall?.amountCents).toBe(1900);

    suite.env.advanceDays(7);
    suite.env.provider.succeedsOnce();
    await suite.env.runBillingCycle();

    await SubscriptionAssertions.for(suite.env, pro.id).hasState('active');
    expect(suite.env.provider.callsForSubscription(pro.id)[0].amountCents).toBe(4900);
    recordCoverage(suite.env);
  });

  it('exercises every transition declared in the lifecycle table', () => {
    expect(
      [...exercisedTransitions].sort(),
      'transitions never exercised by any test in this file'
    ).toEqual(TRANSITION_TABLE.map((t) => t.id).sort());
  });
});
