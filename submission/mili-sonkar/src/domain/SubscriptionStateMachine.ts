import { SubscriptionState, Trigger } from './SubscriptionState.js';

export class InvalidTransitionError extends Error {
    constructor(
        public readonly currentState: SubscriptionState,
        public readonly trigger: Trigger,
    ) {
        super(
            `Invalid transition: state "${currentState}" cannot handle trigger "${trigger}"`,
        );

        this.name = 'InvalidTransitionError';
    }
}

export class SubscriptionStateMachine {
    transition(
        currentState: SubscriptionState,
        trigger: Trigger,
    ): SubscriptionState {
        switch (currentState) {
            case 'trialing':
                switch (trigger) {
                    case Trigger.PaymentSucceeded:
                        return 'active';

                    case Trigger.PaymentFailed:
                        return 'past_due';

                    case Trigger.CancelRequested:
                        return 'canceled';

                    default:
                        throw new InvalidTransitionError(currentState, trigger);
                }

            case 'active':
                switch (trigger) {
                    case Trigger.PaymentFailed:
                        return 'past_due';

                    case Trigger.CancelRequested:
                        return 'canceled';

                    default:
                        throw new InvalidTransitionError(currentState, trigger);
                }

            case 'past_due':
                switch (trigger) {
                    case Trigger.CancelRequested:
                        return 'canceled';

                    case Trigger.RetrySucceeded:
                        return 'active';

                    case Trigger.RetriesExhausted:
                        return 'canceled';

                    default:
                        throw new InvalidTransitionError(currentState, trigger);
                }

            case 'canceled':
                throw new InvalidTransitionError(currentState, trigger);

            default:
                throw new Error(`Unknown subscription state: ${currentState}`);
        }
    }
}