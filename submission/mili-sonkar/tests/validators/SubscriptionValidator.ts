import type { Subscription } from '../../src/domain/Subscription.js';

export interface ValidationResult {
    mismatches: string[];
}

export class SubscriptionValidator {
    validate(actual: Subscription, expected: Subscription): ValidationResult {
        const mismatches: string[] = [];
        for (const field of ['id', 'customerId', 'plan', 'status', 'createdAt', 'updatedAt'] as const) {
            if (actual[field] !== expected[field]) {
                mismatches.push(`${field}: expected ${expected[field]}, received ${actual[field]}`);
            }
        }
        return { mismatches };
    }
}
