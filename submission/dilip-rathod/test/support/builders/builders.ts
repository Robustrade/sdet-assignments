import { randomBytes } from 'node:crypto';

const uid = () => randomBytes(4).toString('hex');

export interface CustomerSeed {
  id: string;
  email: string;
  paymentMethodIds: string[];
}

export class CustomerBuilder {
  private readonly seed: CustomerSeed;

  constructor() {
    const id = `cust_${uid()}`;
    this.seed = { id, email: `${id}@example.test`, paymentMethodIds: [`pm_test_visa_${uid()}`] };
  }

  withId(id: string): this {
    this.seed.id = id;
    this.seed.email = `${id}@example.test`;
    return this;
  }

  withPaymentMethods(...ids: string[]): this {
    this.seed.paymentMethodIds = ids;
    return this;
  }

  build(): CustomerSeed {
    return { ...this.seed, paymentMethodIds: [...this.seed.paymentMethodIds] };
  }
}

export const aCustomer = () => new CustomerBuilder();

type Fields = Record<string, unknown>;

/**
 * Produces a `POST /subscriptions` body. Deliberately untyped output: invalid requests
 * (missing fields, wrong types) are first-class test inputs.
 */
export class SubscriptionRequestBuilder {
  private fields: Fields = { plan: 'pro' };

  forCustomer(customer: CustomerSeed): this {
    this.fields.customer_id = customer.id;
    this.fields.payment_method_id = customer.paymentMethodIds[0];
    return this;
  }

  onPlan(plan: string): this {
    this.fields.plan = plan;
    return this;
  }

  withPaymentMethod(id: string): this {
    this.fields.payment_method_id = id;
    return this;
  }

  with(field: string, value: unknown): this {
    this.fields[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.fields[field];
    return this;
  }

  build(): Fields {
    return { ...this.fields };
  }
}

export const aSubscriptionRequest = () => new SubscriptionRequestBuilder();

export type WebhookType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

/** Anything with the identifying fields of an invoice — an API DTO or a persisted row. */
export interface InvoiceRef {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
}

export class WebhookEventBuilder {
  private fields: Fields;

  private constructor(type: WebhookType) {
    this.fields = { event_id: `evt_${uid()}${uid()}`, type, currency: 'USD' };
  }

  static paymentSucceeded(invoice?: InvoiceRef) {
    return new WebhookEventBuilder('payment.succeeded').forInvoiceIfGiven(invoice);
  }

  static paymentFailed(invoice?: InvoiceRef) {
    return new WebhookEventBuilder('payment.failed').forInvoiceIfGiven(invoice).withFailureCode('card_declined');
  }

  static paymentRefunded(invoice?: InvoiceRef) {
    return new WebhookEventBuilder('payment.refunded').forInvoiceIfGiven(invoice);
  }

  forInvoice(invoice: InvoiceRef): this {
    Object.assign(this.fields, {
      subscription_id: invoice.subscription_id,
      invoice_id: invoice.id,
      amount: invoice.amount,
      currency: invoice.currency,
    });
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

  withSubscriptionId(id: string): this {
    this.fields.subscription_id = id;
    return this;
  }

  withInvoiceId(id: string): this {
    this.fields.invoice_id = id;
    return this;
  }

  withFailureCode(code: string): this {
    this.fields.failure_code = code;
    return this;
  }

  with(field: string, value: unknown): this {
    this.fields[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.fields[field];
    return this;
  }

  build(): Fields & { event_id: string } {
    return { ...this.fields } as Fields & { event_id: string };
  }

  private forInvoiceIfGiven(invoice?: InvoiceRef): this {
    return invoice ? this.forInvoice(invoice) : this;
  }
}
