import { PaymentWebhookType, WebhookPayload } from '../../src/domain/models/webhook-event.model';

export class WebhookPayloadBuilder {
  private payload: WebhookPayload = {
    event_id: 'evt_test_1',
    type: 'payment.succeeded',
    subscription_id: 'sub_1',
    invoice_id: 'inv_test_1',
    amount: 1900,
    currency: 'USD',
  };

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  ofType(type: PaymentWebhookType): this {
    this.payload.type = type;
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  forInvoice(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  withAmount(amount: number, currency = this.payload.currency): this {
    this.payload.amount = amount;
    this.payload.currency = currency;
    return this;
  }

  retriesExhausted(): this {
    this.payload.retries_exhausted = true;
    return this;
  }

  build(): WebhookPayload {
    const payload = { ...this.payload };
    if (payload.retries_exhausted === undefined) {
      delete payload.retries_exhausted;
    }
    return payload;
  }
}
