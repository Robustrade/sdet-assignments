
export type PaymentStatus = 'success' | 'failed' | 'timeout';

export interface PaymentRequest {
    subscriptionId: string;
    amount: number;
    currency: string;
    paymentMethodId: string;
    idempotencyKey: string;
}

export interface PaymentResult {
    transactionId: string;
    status: PaymentStatus;
    message: string;
}

export interface IPaymentProvider {
    processPayment(request: PaymentRequest): Promise<PaymentResult>;
}


export class MockPaymentProvider implements IPaymentProvider {
    private readonly processedPayments = new Map<
        string,
        {
            request: PaymentRequest;
            result: PaymentResult;
        }
    >();

    private callCount = 0;

    constructor(
        private nextStatus: PaymentStatus = 'success'
    ) {}

    setNextStatus(status: PaymentStatus): void {
        this.nextStatus = status;
    }

    getCallCount(): number {
        return this.callCount;
    }

    async processPayment(
        request: PaymentRequest
    ): Promise<PaymentResult> {
        if (!request.idempotencyKey) {
            throw new Error('Idempotency key is required');
        }

        const existing = this.processedPayments.get(
            request.idempotencyKey
        );

        if (existing) {
            const previousRequest = existing.request;

            const isSameRequest =
                previousRequest.subscriptionId === request.subscriptionId &&
                previousRequest.amount === request.amount &&
                previousRequest.currency === request.currency &&
                previousRequest.paymentMethodId === request.paymentMethodId;

            if (!isSameRequest) {
                throw new Error(
                    'Idempotency key reused with different request'
                );
            }

            return existing.result;
        }

        this.callCount++;

        const status = this.nextStatus;
        this.nextStatus = 'success';

        const result: PaymentResult = {
            transactionId: `txn-${this.processedPayments.size + 1}`,
            status,
            message:
                status === 'success'
                    ? 'Payment successful'
                    : status === 'failed'
                        ? 'Payment declined'
                        : 'Payment provider timeout'
        };

        this.processedPayments.set(request.idempotencyKey, {
            request: { ...request },
            result
        });

        return result;
    }
}

