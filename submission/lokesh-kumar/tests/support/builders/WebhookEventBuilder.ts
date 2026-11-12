let eventCounter = 0;

export interface InvoiceRef {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
}

/** Builds inbound webhook payloads. Every build gets a fresh event_id unless one is given. */
export class WebhookEventBuilder {
  private fields: Record<string, unknown>;

  constructor() {
    eventCounter += 1;
    this.fields = {
      event_id: `evt_test_${eventCounter}`,
      type: 'payment.succeeded',
      subscription_id: 'sub_1',
      invoice_id: 'inv_1',
      amount: 4900,
      currency: 'USD',
    };
  }

  succeeded(): this {
    return this.ofType('payment.succeeded');
  }
  failed(): this {
    return this.ofType('payment.failed');
  }
  refunded(): this {
    return this.ofType('payment.refunded');
  }
  ofType(type: string): this {
    this.fields.type = type;
    return this;
  }
  /** Points the event at a real invoice (sets subscription, invoice, amount, currency). */
  forInvoice(invoice: InvoiceRef): this {
    this.fields.subscription_id = invoice.subscriptionId;
    this.fields.invoice_id = invoice.id;
    this.fields.amount = invoice.amount;
    this.fields.currency = invoice.currency;
    return this;
  }
  withEventId(id: string): this {
    this.fields.event_id = id;
    return this;
  }
  withAmount(amount: unknown): this {
    this.fields.amount = amount;
    return this;
  }
  forSubscription(id: string): this {
    this.fields.subscription_id = id;
    return this;
  }
  forUnknownInvoice(id = 'inv_does_not_exist'): this {
    this.fields.invoice_id = id;
    return this;
  }
  without(field: string): this {
    delete this.fields[field];
    return this;
  }
  build(): Record<string, unknown> {
    return { ...this.fields };
  }
}

export const aWebhookEvent = (): WebhookEventBuilder => new WebhookEventBuilder();
