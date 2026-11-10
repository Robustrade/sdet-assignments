/**
 * Unit Tests - Subscription State Pattern
 *
 * Tests the state machine logic without dependencies.
 * Validates all valid and invalid transitions.
 */

import { TrialingState } from '../../../src/domain/subscription/states/TrialingState';
import { ActiveState } from '../../../src/domain/subscription/states/ActiveState';
import { PastDueState } from '../../../src/domain/subscription/states/PastDueState';
import { CanceledState } from '../../../src/domain/subscription/states/CanceledState';

describe('Subscription State Machine', () => {
  describe('TrialingState', () => {
    it('should transition to ActiveState on payment success', () => {
      const state = new TrialingState();
      const nextState = state.onPaymentSuccess();

      expect(nextState).toBeInstanceOf(ActiveState);
      expect(nextState.status).toBe('active');
    });

    it('should transition to PastDueState on payment failure', () => {
      const state = new TrialingState();
      const nextState = state.onPaymentFailure();

      expect(nextState).toBeInstanceOf(PastDueState);
      expect(nextState.status).toBe('past_due');
    });

    it('should transition to CanceledState on cancel', () => {
      const state = new TrialingState();
      const nextState = state.onCancel();

      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should not be terminal', () => {
      const state = new TrialingState();
      expect(state.isTerminal()).toBe(false);
    });
  });

  describe('ActiveState', () => {
    it('should stay in ActiveState on payment success', () => {
      const state = new ActiveState();
      const nextState = state.onPaymentSuccess();

      expect(nextState).toBeInstanceOf(ActiveState);
      expect(nextState.status).toBe('active');
    });

    it('should transition to PastDueState on payment failure', () => {
      const state = new ActiveState();
      const nextState = state.onPaymentFailure();

      expect(nextState).toBeInstanceOf(PastDueState);
      expect(nextState.status).toBe('past_due');
    });

    it('should transition to CanceledState on cancel', () => {
      const state = new ActiveState();
      const nextState = state.onCancel();

      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should not be terminal', () => {
      const state = new ActiveState();
      expect(state.isTerminal()).toBe(false);
    });
  });

  describe('PastDueState', () => {
    it('should transition to ActiveState on payment success', () => {
      const state = new PastDueState();
      const nextState = state.onPaymentSuccess();

      expect(nextState).toBeInstanceOf(ActiveState);
      expect(nextState.status).toBe('active');
    });

    it('should stay in PastDueState on payment failure', () => {
      const state = new PastDueState();
      const nextState = state.onPaymentFailure();

      expect(nextState).toBeInstanceOf(PastDueState);
      expect(nextState.status).toBe('past_due');
    });

    it('should transition to CanceledState when retries exhausted', () => {
      const state = new PastDueState();
      const nextState = state.onRetriesExhausted();

      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should transition to CanceledState on cancel', () => {
      const state = new PastDueState();
      const nextState = state.onCancel();

      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should not be terminal', () => {
      const state = new PastDueState();
      expect(state.isTerminal()).toBe(false);
    });
  });

  describe('CanceledState - Terminal State Invariants', () => {
    it('should NOT transition to ActiveState on payment success (INVALID)', () => {
      const state = new CanceledState();
      const nextState = state.onPaymentSuccess();

      // Should stay canceled - this prevents stray webhooks from reactivating
      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should NOT transition to PastDueState on payment failure (INVALID)', () => {
      const state = new CanceledState();
      const nextState = state.onPaymentFailure();

      // Should stay canceled
      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should stay CanceledState on cancel (idempotent)', () => {
      const state = new CanceledState();
      const nextState = state.onCancel();

      expect(nextState).toBeInstanceOf(CanceledState);
      expect(nextState.status).toBe('canceled');
    });

    it('should be terminal', () => {
      const state = new CanceledState();
      expect(state.isTerminal()).toBe(true);
    });

    it('should ignore all transition attempts when canceled', () => {
      const state = new CanceledState();

      // Try all possible transitions - all should stay canceled
      expect(state.onPaymentSuccess().status).toBe('canceled');
      expect(state.onPaymentFailure().status).toBe('canceled');
      expect(state.onCancel().status).toBe('canceled');
      expect(state.onRetriesExhausted().status).toBe('canceled');
    });
  });

  describe('State Machine Lifecycle Coverage', () => {
    it('should cover full happy path: trialing -> active', () => {
      let state: any = new TrialingState();
      expect(state.status).toBe('trialing');

      // Trial ends, charge succeeds
      state = state.onPaymentSuccess();
      expect(state.status).toBe('active');
    });

    it('should cover trial failure path: trialing -> past_due -> active', () => {
      let state: any = new TrialingState();
      expect(state.status).toBe('trialing');

      // Trial ends, charge fails
      state = state.onPaymentFailure();
      expect(state.status).toBe('past_due');

      // Retry succeeds
      state = state.onPaymentSuccess();
      expect(state.status).toBe('active');
    });

    it('should cover permanent failure path: trialing -> past_due -> canceled', () => {
      let state: any = new TrialingState();

      // Trial ends, charge fails
      state = state.onPaymentFailure();
      expect(state.status).toBe('past_due');

      // Retries exhausted
      state = state.onRetriesExhausted();
      expect(state.status).toBe('canceled');
      expect(state.isTerminal()).toBe(true);
    });

    it('should cover active to past_due path: active -> past_due -> active', () => {
      let state: any = new ActiveState();

      // Recurring charge fails
      state = state.onPaymentFailure();
      expect(state.status).toBe('past_due');

      // Retry succeeds
      state = state.onPaymentSuccess();
      expect(state.status).toBe('active');
    });

    it('should cover cancellation from any non-terminal state', () => {
      // From trialing
      expect(new TrialingState().onCancel().status).toBe('canceled');

      // From active
      expect(new ActiveState().onCancel().status).toBe('canceled');

      // From past_due
      expect(new PastDueState().onCancel().status).toBe('canceled');
    });
  });
});
