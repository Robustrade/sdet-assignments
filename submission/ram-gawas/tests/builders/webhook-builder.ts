import type { PaymentWebhook } from '../../src/subscription-service';

export class WebhookBuilder {
  private webhook: PaymentWebhook = {
    eventId: 'evt_001',
    type: 'payment.succeeded',
    subscriptionId: 'sub_001',
    invoiceId: 'inv_001',
    amount: 4900,
  };

  withEventId(eventId: string): this {
    this.webhook.eventId = eventId;
    return this;
  }

  paymentSucceeded(): this {
    this.webhook.type = 'payment.succeeded';
    return this;
  }

  paymentFailed(): this {
    this.webhook.type = 'payment.failed';
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.webhook.subscriptionId = subscriptionId;
    return this;
  }

  forInvoice(invoiceId: string): this {
    this.webhook.invoiceId = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.webhook.amount = amount;
    return this;
  }

  build(): PaymentWebhook {
    return { ...this.webhook };
  }
}
