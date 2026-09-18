import type { SubscriptionState, Trigger } from '../../src/domain/SubscriptionState.js';
import { SubscriptionStateMachine } from '../../src/domain/SubscriptionStateMachine.js';
import type { ValidationResult } from './SubscriptionValidator.js';

export class StateTransitionValidator {
    private readonly machine = new SubscriptionStateMachine();

    validate(current: SubscriptionState, trigger: Trigger, actual: SubscriptionState): ValidationResult {
        try {
            const expected = this.machine.transition(current, trigger);
            return { mismatches: expected === actual ? [] : [`state: expected ${expected}, received ${actual}`] };
        } catch (error) {
            return { mismatches: [error instanceof Error ? error.message : 'Invalid transition'] };
        }
    }
}
