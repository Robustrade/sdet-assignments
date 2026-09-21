import type { PaymentRequest } from '../../src/infrastructure/payment-provider/PaymentProvider.js';
import type { ValidationResult } from './SubscriptionValidator.js';

export class ProviderInteractionValidator {
    validate(charges: PaymentRequest[], expectedCount: number, expectedCharge?: Partial<PaymentRequest>): ValidationResult {
        const mismatches: string[] = [];
        if (charges.length !== expectedCount) {
            mismatches.push(`charge count: expected ${expectedCount}, received ${charges.length}`);
        }
        if (expectedCharge && charges[0]) {
            for (const [key, value] of Object.entries(expectedCharge)) {
                if (charges[0][key as keyof PaymentRequest] !== value) {
                    mismatches.push(`charge ${key}: expected ${value}, received ${charges[0][key as keyof PaymentRequest]}`);
                }
            }
        }
        return { mismatches };
    }
}
