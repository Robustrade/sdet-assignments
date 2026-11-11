
import {
    MockPaymentProvider,
    PaymentRequest
} from '../../src/providers/PaymentProvider';

describe('MockPaymentProvider', () => {
    let provider: MockPaymentProvider;

    const request: PaymentRequest = {
        subscriptionId: 'sub-001',
        amount: 999,
        currency: 'INR',
        paymentMethodId: 'pm-001',
        idempotencyKey: 'payment-001'
    };

    beforeEach(() => {
        provider = new MockPaymentProvider();
    });

    it('should process a successful payment', async () => {
        const result = await provider.processPayment(request);

        expect(result.status).toBe('success');
        expect(result.transactionId).toBeDefined();
    });

    it('should handle a failed payment', async () => {
        provider.setNextStatus('failed');

        const result = await provider.processPayment(request);

        expect(result.status).toBe('failed');
    });

    it('should handle a payment timeout', async () => {
        provider.setNextStatus('timeout');

        const result = await provider.processPayment(request);

        expect(result.status).toBe('timeout');
    });

    it('should not process the same idempotency key twice', async () => {
        const firstResult = await provider.processPayment(request);
        const secondResult = await provider.processPayment(request);

        expect(secondResult).toEqual(firstResult);
    });

    it('should detect reuse of an idempotency key with a different amount', async () => {
        await provider.processPayment(request);

        const conflictingRequest = {
            ...request,
            amount: 5000
        };

        await expect(
            provider.processPayment(conflictingRequest)
        ).rejects.toThrow('Idempotency key reused with different request');
    });

    it('should reject requests without an idempotency key', async () => {
        const invalidRequest = {
            ...request,
            idempotencyKey: ''
        };

        await expect(
            provider.processPayment(invalidRequest)
        ).rejects.toThrow('Idempotency key is required');
    });
    it('should call the provider only once for duplicate requests', async () => {
        await provider.processPayment(request);
        await provider.processPayment(request);

        expect(provider.getCallCount()).toBe(1);
    });

    it('should not retry a timed-out payment with the same idempotency key', async () => {
        provider.setNextStatus('timeout');

        const firstResult = await provider.processPayment(request);
        const secondResult = await provider.processPayment(request);

        expect(firstResult.status).toBe('timeout');
        expect(secondResult).toEqual(firstResult);
        expect(provider.getCallCount()).toBe(1);
    });

    it('should count only one provider call for duplicate idempotency keys', async () => {
        const provider = new MockPaymentProvider();

        const request = {
            subscriptionId: 'sub-123',
            amount: 1000,
            currency: 'USD',
            paymentMethodId: 'pm-123',
            idempotencyKey: 'key-123'
        };

        await provider.processPayment(request);
        await provider.processPayment(request);

        expect(provider.getCallCount()).toBe(1);
    });

    it('should count separate payment attempts with different idempotency keys', async () => {
        const provider = new MockPaymentProvider();

        const firstRequest = {
            subscriptionId: 'sub-123',
            amount: 1000,
            currency: 'USD',
            paymentMethodId: 'pm-123',
            idempotencyKey: 'key-123'
        };

        const secondRequest = {
            ...firstRequest,
            idempotencyKey: 'key-456'
        };

        await provider.processPayment(firstRequest);
        await provider.processPayment(secondRequest);

        expect(provider.getCallCount()).toBe(2);
    });

});
