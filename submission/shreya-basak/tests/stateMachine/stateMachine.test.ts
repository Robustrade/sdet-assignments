import { SubscriptionStateMachine, InvalidTransitionError } from '../../src/domain/stateMachine';
import { SubscriptionState } from '../../src/domain/types';

describe('SubscriptionStateMachine', () => {
  describe('valid transitions (every one listed in SDET_ASSIGNMENT.md)', () => {
    it('trialing -> active on payment.succeeded (trial-end charge succeeds)', () => {
      expect(SubscriptionStateMachine.nextState('trialing', { kind: 'webhook', type: 'payment.succeeded' })).toBe('active');
    });

    it('trialing -> past_due on payment.failed (trial-end charge fails)', () => {
      expect(SubscriptionStateMachine.nextState('trialing', { kind: 'webhook', type: 'payment.failed' })).toBe('past_due');
    });

    it('active -> past_due on payment.failed (recurring charge fails)', () => {
      expect(SubscriptionStateMachine.nextState('active', { kind: 'webhook', type: 'payment.failed' })).toBe('past_due');
    });

    it('past_due -> active on payment.succeeded (retry charge succeeds)', () => {
      expect(SubscriptionStateMachine.nextState('past_due', { kind: 'webhook', type: 'payment.succeeded' })).toBe('active');
    });

    it('past_due -> canceled when retries are exhausted', () => {
      expect(SubscriptionStateMachine.nextState('past_due', { kind: 'retries_exhausted' })).toBe('canceled');
    });

    it('active -> canceled via API cancel', () => {
      expect(SubscriptionStateMachine.nextState('active', { kind: 'api_cancel' })).toBe('canceled');
    });

    it('trialing -> canceled via API cancel', () => {
      expect(SubscriptionStateMachine.nextState('trialing', { kind: 'api_cancel' })).toBe('canceled');
    });
  });

  describe('invalid / no-op transitions (proven impossible or safely ignored)', () => {
    it('canceling an already-canceled subscription is idempotent (returns null, not an error)', () => {
      expect(SubscriptionStateMachine.nextState('canceled', { kind: 'api_cancel' })).toBeNull();
    });

    it('a payment.succeeded webhook against a canceled subscription is ignored, never reactivates it', () => {
      expect(SubscriptionStateMachine.nextState('canceled', { kind: 'webhook', type: 'payment.succeeded' })).toBeNull();
    });

    it('a payment.failed webhook against a canceled subscription is ignored', () => {
      expect(SubscriptionStateMachine.nextState('canceled', { kind: 'webhook', type: 'payment.failed' })).toBeNull();
    });

    it('payment.refunded never changes lifecycle state, from any state', () => {
      (['trialing', 'active', 'past_due', 'canceled'] as SubscriptionState[]).forEach((state) => {
        expect(SubscriptionStateMachine.nextState(state, { kind: 'webhook', type: 'payment.refunded' })).toBeNull();
      });
    });

    it('rejects retries_exhausted fired against a non-past_due state (proven structurally impossible)', () => {
      expect(() => SubscriptionStateMachine.nextState('active', { kind: 'retries_exhausted' }))
        .toThrow(InvalidTransitionError);
      expect(() => SubscriptionStateMachine.nextState('trialing', { kind: 'retries_exhausted' }))
        .toThrow(InvalidTransitionError);
    });

    it('a payment.failed retry against past_due has no single-event transition (retry counting lives in the service, not the table)', () => {
      expect(SubscriptionStateMachine.nextState('past_due', { kind: 'webhook', type: 'payment.failed' })).toBeNull();
    });
  });
});
