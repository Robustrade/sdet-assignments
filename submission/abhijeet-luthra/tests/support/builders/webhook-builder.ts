import { Invoice } from '../../../src/domain/types';

let eventCounter = 0;

/**
 * Builds provider webhook payloads. `forInvoice` copies subscription, invoice,
 * amount and currency from a real invoice so the default event is valid; tests
 * then override exactly the one thing they want to be wrong.
 */
export class WebhookBuilder {
  private payload: Record<string, unknown> = {
    event_id: `evt_${String(++eventCounter).padStart(4, '0')}`,
    type: 'payment.succeeded',
  };

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

  forInvoice(invoice: Invoice): this {
    Object.assign(this.payload, {
      subscription_id: invoice.subscriptionId,
      invoice_id: invoice.id,
      amount: invoice.amountMinor,
      currency: invoice.currency,
    });
    return this;
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withProviderReference(reference: string): this {
    this.payload.provider_reference = reference;
    return this;
  }

  with(field: string, value: unknown): this {
    this.payload[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.payload[field];
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.payload };
  }
}

export const aWebhook = (): WebhookBuilder => new WebhookBuilder();
