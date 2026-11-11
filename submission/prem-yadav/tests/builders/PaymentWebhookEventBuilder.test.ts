
import { PaymentWebhookEventBuilder } from '../../src/builders/PaymentWebhookEventBuilder';

describe('PaymentWebhookEventBuilder', () => {
    it('should build a valid payment succeeded event', () => {
        const event = new PaymentWebhookEventBuilder()
            .withEventId('evt-001')
            .withType('payment.succeeded')
            .withSubscriptionId('sub-001')
            .withInvoiceId('inv-001')
            .withAmount(100)
            .withCurrency('USD')
            .build();

        expect(event).toEqual({
            event_id: 'evt-001',
            type: 'payment.succeeded',
            subscription_id: 'sub-001',
            invoice_id: 'inv-001',
            amount: 100,
            currency: 'USD'
        });
    });

    it('should build a payment failed event', () => {
        const event = new PaymentWebhookEventBuilder()
            .withEventId('evt-002')
            .withType('payment.failed')
            .withSubscriptionId('sub-002')
            .withInvoiceId('inv-002')
            .withAmount(200)
            .withCurrency('USD')
            .build();

        expect(event.type).toBe('payment.failed');
    });

    it('should reject an event with missing required fields', () => {
        expect(() => {
            new PaymentWebhookEventBuilder()
                .withEventId('evt-003')
                .build();
        }).toThrow('Missing required webhook field: type');
    });

    it('should allow changing a field before building', () => {
        const builder = new PaymentWebhookEventBuilder()
            .withEventId('evt-004')
            .withType('payment.failed')
            .withSubscriptionId('sub-004')
            .withInvoiceId('inv-004')
            .withAmount(100)
            .withCurrency('USD');

        const event = builder
            .withType('payment.succeeded')
            .build();

        expect(event.type).toBe('payment.succeeded');
    });
});
