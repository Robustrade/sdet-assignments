import { BillingError } from '../../../src/errors';
import type { SubscriptionStatus } from '../../../src/domain/Subscription';
import {
  InvalidTransitionError,
  Subscription,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TRIGGERS,
  type SubscriptionTrigger,
} from '../../../src/domain/SubscriptionStateMachine';
import { aSubscriptionRecord } from '../../framework/builders/SubscriptionRecordBuilder';

/**
 * The assignment's lifecycle diagram, written out independently of the implementation.
 * It is the test oracle: anything not listed here must be rejected.
 */
const VALID_TRANSITIONS: ReadonlyArray<{
  id: string;
  from: SubscriptionStatus;
  trigger: SubscriptionTrigger;
  to: SubscriptionStatus;
  meaning: string;
}> = [
  { id: 'V1', from: 'trialing', trigger: 'charge_succeeded', to: 'active', meaning: 'trial ends, first charge succeeds' },
  { id: 'V2', from: 'trialing', trigger: 'charge_failed', to: 'past_due', meaning: 'trial ends, first charge fails' },
  { id: 'V3', from: 'active', trigger: 'charge_failed', to: 'past_due', meaning: 'recurring charge fails' },
  { id: 'V4', from: 'past_due', trigger: 'charge_succeeded', to: 'active', meaning: 'retry charge succeeds' },
  { id: 'V5', from: 'past_due', trigger: 'retries_exhausted', to: 'canceled', meaning: 'retries exhausted' },
  { id: 'V6', from: 'active', trigger: 'cancel', to: 'canceled', meaning: 'customer/API cancel' },
  { id: 'V7', from: 'trialing', trigger: 'cancel', to: 'canceled', meaning: 'customer/API cancel' },
];

const subscriptionIn = (status: SubscriptionStatus): Subscription =>
  Subscription.rehydrate(aSubscriptionRecord().inStatus(status).build());

describe('Subscription state machine', () => {
  describe('valid transitions (every arrow in the lifecycle diagram)', () => {
    it.each(VALID_TRANSITIONS)('$id: $from --($trigger)--> $to ($meaning)', ({ from, trigger, to }) => {
      const subscription = subscriptionIn(from);

      const result = subscription.apply(trigger);

      expect(result).toEqual({ from, trigger, to });
      expect(subscription.status).toBe(to);
    });

    it('reflects the new status in the persisted snapshot and leaves every other field untouched', () => {
      const before = aSubscriptionRecord().inStatus('trialing').build();
      const subscription = Subscription.rehydrate(before);

      subscription.apply('charge_succeeded');

      expect(subscription.toRecord()).toEqual({ ...before, status: 'active' });
    });

    it('supports a full multi-step journey: trialing -> past_due -> active -> past_due -> canceled', () => {
      const subscription = subscriptionIn('trialing');

      const visited = (['charge_failed', 'charge_succeeded', 'charge_failed', 'retries_exhausted'] as const).map(
        (trigger) => {
          subscription.apply(trigger);
          return subscription.status;
        },
      );

      expect(visited).toEqual(['past_due', 'active', 'past_due', 'canceled']);
    });
  });

  describe('invalid transitions', () => {
    const validKeys = new Set(VALID_TRANSITIONS.map(({ from, trigger }) => `${from}|${trigger}`));
    const invalidPairs = SUBSCRIPTION_STATUSES.flatMap((from) =>
      SUBSCRIPTION_TRIGGERS.filter((trigger) => !validKeys.has(`${from}|${trigger}`)).map(
        (trigger) => ({ from, trigger }),
      ),
    );

    it('covers the whole state x trigger matrix: 7 valid + 9 invalid = 16 pairs', () => {
      expect(SUBSCRIPTION_STATUSES).toHaveLength(4);
      expect(SUBSCRIPTION_TRIGGERS).toHaveLength(4);
      expect(VALID_TRANSITIONS).toHaveLength(7);
      expect(invalidPairs).toHaveLength(9);
    });

    it.each(invalidPairs)('rejects $from + $trigger and leaves the status unchanged', ({ from, trigger }) => {
      const subscription = subscriptionIn(from);

      expect(() => subscription.apply(trigger)).toThrow(InvalidTransitionError);
      expect(subscription.status).toBe(from);
    });

    it('treats canceled as terminal: no trigger can move it anywhere', () => {
      const subscription = subscriptionIn('canceled');

      for (const trigger of SUBSCRIPTION_TRIGGERS) {
        expect(() => subscription.apply(trigger)).toThrow(InvalidTransitionError);
      }
      expect(subscription.status).toBe('canceled');
    });

    it('does not allow canceling a past_due subscription (that arrow is not in the diagram)', () => {
      expect(() => subscriptionIn('past_due').apply('cancel')).toThrow(InvalidTransitionError);
    });

    it('rejects retries_exhausted unless the subscription is past_due', () => {
      for (const status of ['trialing', 'active', 'canceled'] as const) {
        expect(() => subscriptionIn(status).apply('retries_exhausted')).toThrow(InvalidTransitionError);
      }
    });

    it('rejects a trigger name it does not know, instead of silently accepting it', () => {
      const subscription = subscriptionIn('active');

      expect(() => subscription.apply('refund' as SubscriptionTrigger)).toThrow(InvalidTransitionError);
      expect(subscription.status).toBe('active');
    });

    it('does not change the persisted snapshot when a transition is rejected', () => {
      const before = aSubscriptionRecord().inStatus('canceled').build();
      const subscription = Subscription.rehydrate(before);

      expect(() => subscription.apply('charge_succeeded')).toThrow();

      expect(subscription.toRecord()).toEqual(before);
    });
  });

  describe('InvalidTransitionError', () => {
    it('names the state and trigger, and is a client-facing BillingError with code invalid_transition', () => {
      const attempt = () => subscriptionIn('canceled').apply('charge_succeeded');

      expect(attempt).toThrow(InvalidTransitionError);
      try {
        attempt();
      } catch (error) {
        expect(error).toBeInstanceOf(BillingError);
        const typed = error as InvalidTransitionError;
        expect(typed.code).toBe('invalid_transition');
        expect(typed.from).toBe('canceled');
        expect(typed.trigger).toBe('charge_succeeded');
        expect(typed.message).toContain('canceled');
        expect(typed.message).toContain('charge_succeeded');
      }
    });
  });

  describe('structural enforcement (status cannot be set from outside)', () => {
    it('has a read-only status: direct assignment fails and the state is unchanged', () => {
      const subscription = subscriptionIn('canceled');

      expect(() => {
        // @ts-expect-error status is a getter-only property; the compiler must reject this
        subscription.status = 'active';
      }).toThrow(TypeError);
      expect(subscription.status).toBe('canceled');
    });

    it('does not let the caller mutate state through the record it was built from', () => {
      const record = aSubscriptionRecord().inStatus('active').build();
      const subscription = Subscription.rehydrate(record);

      (record as { status: SubscriptionStatus }).status = 'canceled';

      expect(subscription.status).toBe('active');
    });

    it('does not let the caller mutate state through the snapshot it was handed', () => {
      const subscription = subscriptionIn('active');

      (subscription.toRecord() as { status: SubscriptionStatus }).status = 'canceled';

      expect(subscription.status).toBe('active');
    });
  });
});
