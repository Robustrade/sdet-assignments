import { randomUUID } from 'crypto';
import { InboundWebhookPayload, WebhookEventType } from '../../domain/types';

/** Builder pattern: constructs valid webhook payloads that tests can mutate for specific scenarios (duplicates, out-of-order, wrong invoice). */
export class WebhookPayloadBuilder {
  private payload: InboundWebhookPayload = {
    event_id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    subscription_id: 'sub_placeholder',
    invoice_id: `inv_${randomUUID()}`,
    amount: 4900,
    currency: 'USD',
  };

  forSubscription(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  withType(type: WebhookEventType): this {
    this.payload.type = type;
    return this;
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  build(): InboundWebhookPayload {
    return { ...this.payload };
  }
}
