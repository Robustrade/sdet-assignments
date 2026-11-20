import { randomUUID } from 'node:crypto';
import type { CreateSubscription, Invoice, WebhookEvent, WebhookType } from '../../src/domain.ts';

export class SubscriptionBuilder {
  private data: CreateSubscription = {
    customer_id: 'cust_001', plan: 'basic', payment_method_id: 'pm_test_visa_4242',
  };
  with(overrides: Partial<CreateSubscription>): this {
    this.data = { ...this.data, ...overrides }; return this;
  }
  build(): CreateSubscription { return { ...this.data }; }
}

export class WebhookBuilder {
  private data: WebhookEvent;
  constructor(invoice: Invoice) {
    this.data = {
      event_id: `evt_${randomUUID()}`, type: 'payment.succeeded',
      subscription_id: invoice.subscription_id, invoice_id: invoice.id,
      amount: invoice.amount, currency: invoice.currency,
    };
  }
  ofType(type: WebhookType): this { this.data.type = type; return this; }
  with(overrides: Partial<WebhookEvent>): this {
    this.data = { ...this.data, ...overrides }; return this;
  }
  build(): WebhookEvent { return { ...this.data }; }
}
