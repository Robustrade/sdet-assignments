import type { WebhookPayload } from '../mocks/webhookSimulator';

/** Builder for subscription creation bodies (API-level test data). */
export class CreateSubscriptionBuilder {
  private body: Record<string, unknown> = {
    customer_id: 'cust_001',
    plan: 'pro',
    payment_method_id: 'pm_test_visa_4242',
  };

  customer(id: string): this {
    this.body['customer_id'] = id;
    return this;
  }

  plan(plan: string): this {
    this.body['plan'] = plan;
    return this;
  }

  paymentMethod(id: string): this {
    this.body['payment_method_id'] = id;
    return this;
  }

  without(field: string): this {
    delete this.body[field];
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.body };
  }
}

/** Builder for inbound webhook payloads. */
export class WebhookPayloadBuilder {
  private payload: WebhookPayload = {
    event_id: 'evt_001',
    type: 'payment.succeeded',
    subscription_id: 'sub_001',
    invoice_id: 'inv_001',
    amount: 4900,
    currency: 'USD',
  };

  eventId(id: string): this {
    this.payload.event_id = id;
    return this;
  }

  type(type: WebhookPayload['type']): this {
    this.payload.type = type;
    return this;
  }

  subscriptionId(id: string): this {
    this.payload.subscription_id = id;
    return this;
  }

  invoiceId(id: string): this {
    this.payload.invoice_id = id;
    return this;
  }

  amount(cents: number): this {
    this.payload.amount = cents;
    return this;
  }

  build(): WebhookPayload {
    return { ...this.payload };
  }
}
