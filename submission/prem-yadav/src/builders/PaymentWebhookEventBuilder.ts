
import {
    PaymentWebhookEvent
} from '../services/PaymentWebhookHandler';

export class PaymentWebhookEventBuilder {
    private event: Partial<PaymentWebhookEvent> = {};

    withEventId(eventId: string): this {
        this.event.event_id = eventId;
        return this;
    }

    withType(
        type: PaymentWebhookEvent['type']
    ): this {
        this.event.type = type;
        return this;
    }

    withSubscriptionId(subscriptionId: string): this {
        this.event.subscription_id = subscriptionId;
        return this;
    }

    withInvoiceId(invoiceId: string): this {
        this.event.invoice_id = invoiceId;
        return this;
    }

    withAmount(amount: number): this {
        this.event.amount = amount;
        return this;
    }

    withCurrency(currency: string): this {
        this.event.currency = currency;
        return this;
    }

    build(): PaymentWebhookEvent {
        const requiredFields: (keyof PaymentWebhookEvent)[] = [
            'event_id',
            'type',
            'subscription_id',
            'invoice_id',
            'amount',
            'currency'
        ];

        for (const field of requiredFields) {
            if (this.event[field] === undefined) {
                throw new Error(`Missing required webhook field: ${field}`);
            }
        }

        return this.event as PaymentWebhookEvent;
    }
}
