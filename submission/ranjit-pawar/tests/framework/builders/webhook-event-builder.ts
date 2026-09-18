import type { InvoiceResource, SubscriptionResource } from '../clients/subscription-api-client';
import type { WebhookEventType } from '../../../src/domain/types';

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

let eventCounter = 0;

/**
 * BUILDER for inbound provider events.
 *
 * Two properties matter for these tests and are easy to get wrong by hand:
 * event ids must be unique unless a test is deliberately replaying one, and the
 * amount must match the invoice unless a test is deliberately forging it.
 */
export class WebhookEventBuilder {
  private payload: WebhookPayload = {
    event_id: '',
    type: 'payment.succeeded',
    subscription_id: 'sub_001',
    invoice_id: 'inv_001',
    amount: 4900,
    currency: 'USD'
  };

  static anEvent(): WebhookEventBuilder {
    const builder = new WebhookEventBuilder();
    builder.payload.event_id = WebhookEventBuilder.nextEventId();
    return builder;
  }

  static nextEventId(): string {
    eventCounter += 1;
    return `evt_${String(eventCounter).padStart(6, '0')}`;
  }

  static resetIds(): void {
    eventCounter = 0;
  }

  succeeded(): this {
    this.payload.type = 'payment.succeeded';
    return this;
  }

  failed(): this {
    this.payload.type = 'payment.failed';
    return this;
  }

  refunded(): this {
    this.payload.type = 'payment.refunded';
    return this;
  }

  ofType(type: WebhookEventType): this {
    this.payload.type = type;
    return this;
  }

  forSubscription(subscription: SubscriptionResource | string): this {
    this.payload.subscription_id = typeof subscription === 'string' ? subscription : subscription.id;
    return this;
  }

  /** Copies subscription, invoice id, amount and currency in one call. */
  forInvoice(invoice: InvoiceResource): this {
    this.payload.invoice_id = invoice.id;
    this.payload.subscription_id = invoice.subscription_id;
    this.payload.amount = invoice.amount;
    this.payload.currency = invoice.currency;
    return this;
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.payload.currency = currency;
    return this;
  }

  with(field: string, value: unknown): this {
    (this.payload as unknown as Record<string, unknown>)[field] = value;
    return this;
  }

  without(field: keyof WebhookPayload): this {
    delete (this.payload as unknown as Record<string, unknown>)[field];
    return this;
  }

  /** A redelivery of an already-sent event: same id, same content. */
  asRedeliveryOf(payload: WebhookPayload): this {
    this.payload = structuredClone(payload);
    return this;
  }

  build(): WebhookPayload {
    return structuredClone(this.payload);
  }
}
