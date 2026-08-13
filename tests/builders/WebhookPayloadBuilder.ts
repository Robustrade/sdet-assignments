import type { WebhookEventType } from '../../src/domain/types.js';

export interface WebhookApiPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export class WebhookPayloadBuilder {
  private data: WebhookApiPayload = {
    event_id: 'evt_default',
    type: 'payment.succeeded',
    subscription_id: 'sub_default',
    invoice_id: 'inv_default',
    amount: 4900,
    currency: 'USD',
  };

  withEventId(id: string): this {
    this.data.event_id = id;
    return this;
  }

  ofType(type: WebhookEventType): this {
    this.data.type = type;
    return this;
  }

  forSubscription(id: string): this {
    this.data.subscription_id = id;
    return this;
  }

  forInvoice(id: string): this {
    this.data.invoice_id = id;
    return this;
  }

  withAmount(amount: number): this {
    this.data.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.data.currency = currency;
    return this;
  }

  build(): WebhookApiPayload {
    return { ...this.data };
  }
}