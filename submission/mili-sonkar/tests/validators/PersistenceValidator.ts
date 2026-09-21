import type { Subscription } from '../../src/domain/Subscription.js';
import type { ValidationResult } from './SubscriptionValidator.js';

export class PersistenceValidator {
    validate(apiSubscription: Subscription, persistedSubscription: Subscription): ValidationResult {
        const mismatches: string[] = [];
        for (const field of ['id', 'customerId', 'plan', 'status', 'createdAt', 'updatedAt'] as const) {
            if (apiSubscription[field] !== persistedSubscription[field]) {
                mismatches.push(`API/DB ${field}: API ${apiSubscription[field]}, DB ${persistedSubscription[field]}`);
            }
        }
        return { mismatches };
    }
}
