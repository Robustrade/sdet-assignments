import type {
    PaymentProvider,
    PaymentRequest,
    PaymentResult,
} from './PaymentProvider.js';

export class MockPaymentProvider implements PaymentProvider {
    private readonly charges: PaymentRequest[] = [];
    private shouldSucceed = true;
    private failureCode = 'payment_failed';
    private failureMessage = 'Payment provider rejected the charge';

    setPaymentOutcome(success: boolean): void {
        this.shouldSucceed = success;
    }

    setFailure(
        errorCode: string,
        errorMessage: string,
    ): void {
        this.failureCode = errorCode;
        this.failureMessage = errorMessage;
        this.shouldSucceed = false;
    }

    charge(request: PaymentRequest): PaymentResult {
        this.charges.push({ ...request });

        if (!this.shouldSucceed) {
            return {
                success: false,
                providerPaymentId: `mock-failed-${this.charges.length}`,
                amount: request.amount,
                currency: request.currency,
                errorCode: this.failureCode,
                errorMessage: this.failureMessage,
            };
        }

        return {
            success: true,
            providerPaymentId: `mock-payment-${this.charges.length}`,
            amount: request.amount,
            currency: request.currency,
        };
    }

    getChargeCount(): number {
        return this.charges.length;
    }

    getCharges(): PaymentRequest[] {
        return this.charges.map((charge) => ({ ...charge }));
    }

    reset(): void {
        this.charges.length = 0;
        this.shouldSucceed = true;
    }
}