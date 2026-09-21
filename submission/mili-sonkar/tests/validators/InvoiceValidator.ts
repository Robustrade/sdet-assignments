import type { Invoice } from '../../src/domain/Invoice.js';
import type { ValidationResult } from './SubscriptionValidator.js';

export class InvoiceValidator {
    validate(actual: Invoice, expected: Invoice): ValidationResult {
        const mismatches: string[] = [];
        for (const field of ['id', 'subscriptionId', 'amount', 'currency', 'status'] as const) {
            if (actual[field] !== expected[field]) {
                mismatches.push(`${field}: expected ${expected[field]}, received ${actual[field]}`);
            }
        }
        return { mismatches };
    }
}
