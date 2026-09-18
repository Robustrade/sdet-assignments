import type { WebhookEventType } from '../../src/application/WebhookProcessor.js';
import type { WebhookRequest } from '../clients/WebhookApiClient.js';

export class WebhookEventBuilder {
    private value: WebhookRequest = {
        event_id: `evt-${crypto.randomUUID()}`,
        event_type: 'payment.succeeded',
        subscription_id: '',
    };

    forSubscription(subscriptionId: string): this {
        this.value.subscription_id = subscriptionId;
        return this;
    }

    withEventType(eventType: WebhookEventType): this {
        this.value.event_type = eventType;
        return this;
    }

    withEventId(eventId: string): this {
        this.value.event_id = eventId;
        return this;
    }

    build(): WebhookRequest {
        return { ...this.value };
    }
}
