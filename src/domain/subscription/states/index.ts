/**
 * State Pattern Exports
 */

export { SubscriptionState } from './SubscriptionState';
export { TrialingState } from './TrialingState';
export { ActiveState } from './ActiveState';
export { PastDueState } from './PastDueState';
export { CanceledState } from './CanceledState';

// Factory function to create state from status string
import { SubscriptionStatus } from '../types';
import { SubscriptionState } from './SubscriptionState';
import { TrialingState } from './TrialingState';
import { ActiveState } from './ActiveState';
import { PastDueState } from './PastDueState';
import { CanceledState } from './CanceledState';

export function createStateFromStatus(status: SubscriptionStatus): SubscriptionState {
  switch (status) {
    case 'trialing':
      return new TrialingState();
    case 'active':
      return new ActiveState();
    case 'past_due':
      return new PastDueState();
    case 'canceled':
      return new CanceledState();
    default:
      throw new Error(`Unknown subscription status: ${status}`);
  }
}

// Alias for convenience
export const createState = createStateFromStatus;
