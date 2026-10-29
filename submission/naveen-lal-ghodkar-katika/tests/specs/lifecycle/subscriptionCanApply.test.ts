import {
  Subscription,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TRIGGERS,
} from '../../../src/domain/SubscriptionStateMachine';
import { aSubscriptionRecord } from '../../framework/builders/SubscriptionRecordBuilder';

/**
 * `can(trigger)` lets services ask the transition table before acting, instead of branching on status
 * strings. It must agree with `apply` for every (status, trigger) pair and must never change state.
 */
describe('Subscription.can', () => {
  const pairs = SUBSCRIPTION_STATUSES.flatMap((status) => SUBSCRIPTION_TRIGGERS.map((trigger) => [status, trigger] as const));

  it.each(pairs)('agrees with apply for %s + %s', (status, trigger) => {
    const subscription = Subscription.rehydrate(aSubscriptionRecord().inStatus(status).build());
    const allowed = subscription.can(trigger);

    const attempt = () => Subscription.rehydrate(aSubscriptionRecord().inStatus(status).build()).apply(trigger);

    if (allowed) {
      expect(attempt).not.toThrow();
    } else {
      expect(attempt).toThrow();
    }
  });

  it('does not change the status', () => {
    const subscription = Subscription.rehydrate(aSubscriptionRecord().inStatus('trialing').build());

    subscription.can('charge_succeeded');
    subscription.can('cancel');

    expect(subscription.status).toBe('trialing');
  });

  it('allows exactly the seven arrows of the lifecycle diagram', () => {
    const allowed = pairs.filter(([status, trigger]) =>
      Subscription.rehydrate(aSubscriptionRecord().inStatus(status).build()).can(trigger),
    );

    expect(allowed).toHaveLength(7);
  });
});
