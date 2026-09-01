/**
 * State Pattern: Subscription Lifecycle States
 *
 * Each state encapsulates allowed transitions and behavior.
 * This makes illegal transitions structurally hard to reach.
 */

import { SubscriptionState } from '../types';

export interface SubscriptionStateHandler {
  name: SubscriptionState;
  
  // Allowed transitions from this state
  canTransitionTo(targetState: SubscriptionState): boolean;
  
  // State-specific business logic (optional)
  onEnter?(): void;
  onExit?(): void;
}

// Trialing: Initial state, trial period active, no payment yet
export class TrialingState implements SubscriptionStateHandler {
  name: SubscriptionState = 'trialing';

  canTransitionTo(targetState: SubscriptionState): boolean {
    // From trialing, can go to: active, past_due, canceled
    return targetState === 'active' || 
           targetState === 'past_due' || 
           targetState === 'canceled';
  }
}

// Active: Subscription active, customer billed, next invoice due
export class ActiveState implements SubscriptionStateHandler {
  name: SubscriptionState = 'active';

  canTransitionTo(targetState: SubscriptionState): boolean {
    // From active, can go to: past_due, canceled
    return targetState === 'past_due' || targetState === 'canceled';
  }
}

// PastDue: Payment failed, subscription suspended, retries pending
export class PastDueState implements SubscriptionStateHandler {
  name: SubscriptionState = 'past_due';

  canTransitionTo(targetState: SubscriptionState): boolean {
    // From past_due, can go to: active (retry succeeded), canceled (retries exhausted)
    return targetState === 'active' || targetState === 'canceled';
  }
}

// Canceled: Subscription ended, no further transitions
export class CanceledState implements SubscriptionStateHandler {
  name: SubscriptionState = 'canceled';

  canTransitionTo(targetState: SubscriptionState): boolean {
    // Canceled is terminal; no further transitions allowed
    return false;
  }
}

export class StateFactory {
  private static states: Map<SubscriptionState, SubscriptionStateHandler> = new Map([
    ['trialing', new TrialingState()],
    ['active', new ActiveState()],
    ['past_due', new PastDueState()],
    ['canceled', new CanceledState()],
  ]);

  static getState(state: SubscriptionState): SubscriptionStateHandler {
    const handler = this.states.get(state);
    if (!handler) {
      throw new Error(`Unknown subscription state: ${state}`);
    }
    return handler;
  }

  static isValidTransition(from: SubscriptionState, to: SubscriptionState): boolean {
    if (from === to) return true; // No-op is valid
    const currentState = this.getState(from);
    return currentState.canTransitionTo(to);
  }
}
