import { Customer, PaymentMethod, WebhookEventType } from '../../../src/domain/types';
import { SEED, TEST_EPOCH } from '../fixtures';

// ---------------------------------------------------------------------------
// Customers

export class CustomerBuilder {
  private id: string = SEED.alice.customerId;
  private readonly cards: Array<Omit<PaymentMethod, 'customerId'>> = [];

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withCard(id: string, options: { brand?: string; last4?: string; expired?: boolean } = {}): this {
    this.cards.push({
      id,
      brand: options.brand ?? 'visa',
      last4: options.last4 ?? id.match(/(\d{4})$/)?.[1] ?? '4242',
      status: options.expired ? 'expired' : 'active',
    });
    return this;
  }

  build(): { customer: Customer; paymentMethods: PaymentMethod[] } {
    return {
      customer: { id: this.id, email: `${this.id}@example.test`, createdAt: TEST_EPOCH },
      paymentMethods: this.cards.map((card) => ({ ...card, customerId: this.id })),
    };
  }
}

export const aCustomer = (): CustomerBuilder => new CustomerBuilder();

// ---------------------------------------------------------------------------
// Signup requests (body of POST /subscriptions)

export interface SignupRequestBody {
  customer_id?: unknown;
  plan?: unknown;
  payment_method_id?: unknown;
  [extra: string]: unknown;
}

export class SignupRequestBuilder {
  private body: SignupRequestBody = {
    customer_id: SEED.alice.customerId,
    plan: 'basic',
    payment_method_id: SEED.alice.card,
  };

  forCustomer(customerId: string, paymentMethodId?: string): this {
    this.body.customer_id = customerId;
    if (paymentMethodId) this.body.payment_method_id = paymentMethodId;
    return this;
  }

  onPlan(plan: string): this {
    this.body.plan = plan;
    return this;
  }

  /** basic: starts with a 14-day trial, nothing charged at signup. */
  onBasicPlan(): this {
    return this.onPlan('basic');
  }

  /** pro: no trial, charged at signup. */
  onProPlan(): this {
    return this.onPlan('pro');
  }

  payingWith(paymentMethodId: string): this {
    this.body.payment_method_id = paymentMethodId;
    return this;
  }

  without(field: 'customer_id' | 'plan' | 'payment_method_id'): this {
    delete this.body[field];
    return this;
  }

  with(field: string, value: unknown): this {
    this.body[field] = value;
    return this;
  }

  build(): SignupRequestBody {
    return { ...this.body };
  }
}

export const aSignupRequest = (): SignupRequestBuilder => new SignupRequestBuilder();

// ---------------------------------------------------------------------------
// Provider webhooks

export interface WebhookPayload {
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  charge_id?: string;
  failure_reason?: string;
  [extra: string]: unknown;
}

let eventSeq = 0;

export class WebhookEventBuilder {
  private payload: WebhookPayload;

  constructor() {
    eventSeq++;
    this.payload = {
      event_id: `evt_${String(eventSeq).padStart(6, '0')}`,
      type: 'payment.succeeded',
      subscription_id: 'sub_0001',
      invoice_id: 'inv_0001',
      amount: 1900,
      currency: 'USD',
    };
  }

  paymentSucceeded(): this {
    this.payload.type = 'payment.succeeded';
    delete this.payload.failure_reason;
    return this;
  }

  paymentFailed(reason = 'card_declined'): this {
    this.payload.type = 'payment.failed';
    this.payload.failure_reason = reason;
    return this;
  }

  paymentRefunded(): this {
    this.payload.type = 'payment.refunded';
    delete this.payload.failure_reason;
    return this;
  }

  ofType(type: WebhookEventType): this {
    if (type === 'payment.succeeded') return this.paymentSucceeded();
    if (type === 'payment.failed') return this.paymentFailed();
    return this.paymentRefunded();
  }

  /** Point the event at a real invoice; amount defaults to the invoice amount. */
  forInvoice(invoice: { subscriptionId: string; id: string; amountCents: number }): this {
    this.payload.subscription_id = invoice.subscriptionId;
    this.payload.invoice_id = invoice.id;
    this.payload.amount = invoice.amountCents;
    return this;
  }

  withChargeId(chargeId: string): this {
    this.payload.charge_id = chargeId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  with(field: string, value: unknown): this {
    this.payload[field] = value;
    return this;
  }

  without(field: keyof WebhookPayload): this {
    delete this.payload[field];
    return this;
  }

  build(): WebhookPayload {
    return { ...this.payload };
  }
}

export const aWebhook = (): WebhookEventBuilder => new WebhookEventBuilder();
