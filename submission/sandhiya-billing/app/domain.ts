export const SubscriptionState = Object.freeze({
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
});

export type SubscriptionState = (typeof SubscriptionState)[keyof typeof SubscriptionState];

export interface PlanOptions {
  code: string;
  priceCents: number;
  trialDays: number;
  immediateCharge?: boolean;
}

export class Plan {
  readonly code: string;
  readonly priceCents: number;
  readonly trialDays: number;
  readonly immediateCharge: boolean;

  constructor({ code, priceCents, trialDays, immediateCharge = false }: PlanOptions) {
    this.code = code;
    this.priceCents = priceCents;
    this.trialDays = trialDays;
    this.immediateCharge = immediateCharge;
    Object.freeze(this);
  }
}

export const PLANS: Readonly<Record<string, Plan>> = Object.freeze({
  basic: new Plan({ code: "basic", priceCents: 1000, trialDays: 7 }),
  pro: new Plan({ code: "pro", priceCents: 4900, trialDays: 14 }),
});

export interface SubscriptionOptions {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
  state?: SubscriptionState;
  createdAt?: string;
  trialDays?: number;
  priceCents?: number;
}

export class Subscription {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
  state: SubscriptionState;
  createdAt: string;
  trialDays: number;
  priceCents: number;

  constructor({
    id,
    customerId,
    plan,
    paymentMethodId,
    state = SubscriptionState.TRIALING,
    createdAt = new Date().toISOString(),
    trialDays = 0,
    priceCents = 0,
  }: SubscriptionOptions) {
    this.id = id;
    this.customerId = customerId;
    this.plan = plan;
    this.paymentMethodId = paymentMethodId;
    this.state = state;
    this.createdAt = createdAt;
    this.trialDays = trialDays;
    this.priceCents = priceCents;
  }

  toJSON(): {
    id: string;
    customer_id: string;
    plan: string;
    state: SubscriptionState;
    payment_method_id: string;
    created_at: string;
    trial_days: number;
    price_cents: number;
  } {
    return {
      id: this.id,
      customer_id: this.customerId,
      plan: this.plan,
      state: this.state,
      payment_method_id: this.paymentMethodId,
      created_at: this.createdAt,
      trial_days: this.trialDays,
      price_cents: this.priceCents,
    };
  }
}

export interface InvoiceOptions {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency?: string;
  status?: string;
  createdAt?: string;
}

export class Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;

  constructor({
    id,
    subscriptionId,
    amountCents,
    currency = "USD",
    status = "pending",
    createdAt = new Date().toISOString(),
  }: InvoiceOptions) {
    this.id = id;
    this.subscriptionId = subscriptionId;
    this.amountCents = amountCents;
    this.currency = currency;
    this.status = status;
    this.createdAt = createdAt;
  }

  toJSON(): {
    id: string;
    subscription_id: string;
    amount_cents: number;
    currency: string;
    status: string;
    created_at: string;
  } {
    return {
      id: this.id,
      subscription_id: this.subscriptionId,
      amount_cents: this.amountCents,
      currency: this.currency,
      status: this.status,
      created_at: this.createdAt,
    };
  }
}

export interface PaymentEventOptions {
  eventId: string;
  subscriptionId: string;
  eventType: string;
  invoiceId: string;
  amountCents: number;
  currency?: string;
  processedAt?: string;
}

export class PaymentEvent {
  eventId: string;
  subscriptionId: string;
  eventType: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  processedAt: string;

  constructor({
    eventId,
    subscriptionId,
    eventType,
    invoiceId,
    amountCents,
    currency = "USD",
    processedAt = new Date().toISOString(),
  }: PaymentEventOptions) {
    this.eventId = eventId;
    this.subscriptionId = subscriptionId;
    this.eventType = eventType;
    this.invoiceId = invoiceId;
    this.amountCents = amountCents;
    this.currency = currency;
    this.processedAt = processedAt;
  }

  toJSON(): {
    event_id: string;
    subscription_id: string;
    event_type: string;
    invoice_id: string;
    amount_cents: number;
    currency: string;
    processed_at: string;
  } {
    return {
      event_id: this.eventId,
      subscription_id: this.subscriptionId,
      event_type: this.eventType,
      invoice_id: this.invoiceId,
      amount_cents: this.amountCents,
      currency: this.currency,
      processed_at: this.processedAt,
    };
  }
}

export class InvalidTransitionError extends Error {
  current: string;
  requested: string;

  constructor(current: string, requested: string) {
    super(`Invalid transition from ${current} to ${requested}`);
    this.name = "InvalidTransitionError";
    this.current = current;
    this.requested = requested;
  }
}

export class SubscriptionStateMachine {
  static allowedTransitions: Readonly<Record<SubscriptionState, ReadonlySet<SubscriptionState>>> = Object.freeze({
    [SubscriptionState.TRIALING]: new Set([
      SubscriptionState.ACTIVE,
      SubscriptionState.PAST_DUE,
      SubscriptionState.CANCELED,
    ]),
    [SubscriptionState.ACTIVE]: new Set([
      SubscriptionState.PAST_DUE,
      SubscriptionState.CANCELED,
    ]),
    [SubscriptionState.PAST_DUE]: new Set([
      SubscriptionState.ACTIVE,
      SubscriptionState.CANCELED,
    ]),
    [SubscriptionState.CANCELED]: new Set<SubscriptionState>(),
  });

  transition(current: SubscriptionState, requested: SubscriptionState): SubscriptionState {
    const allowed = SubscriptionStateMachine.allowedTransitions[current] ?? new Set<SubscriptionState>();
    if (!allowed.has(requested)) {
      throw new InvalidTransitionError(current, requested);
    }
    return requested;
  }
}

export class SubscriptionBuilder {
  customerId: string;
  plan: string;
  paymentMethodId: string;
  subscriptionId: string;
  state: SubscriptionState;

  constructor() {
    this.customerId = "cust_001";
    this.plan = "pro";
    this.paymentMethodId = "pm_test_visa_4242";
    this.subscriptionId = "sub_001";
    this.state = SubscriptionState.TRIALING;
  }

  withCustomer(customerId: string): this {
    this.customerId = customerId;
    return this;
  }

  withPlan(plan: string): this {
    this.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.paymentMethodId = paymentMethodId;
    return this;
  }

  withId(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  withState(state: SubscriptionState): this {
    this.state = state;
    return this;
  }

  build(): Subscription {
    const plan = PLANS[this.plan];
    if (!plan) {
      throw new Error(`Unknown plan: ${this.plan}`);
    }
    return new Subscription({
      id: this.subscriptionId,
      customerId: this.customerId,
      plan: this.plan,
      paymentMethodId: this.paymentMethodId,
      state: this.state,
      trialDays: plan.trialDays,
      priceCents: plan.priceCents,
    });
  }
}

export class WebhookPayloadBuilder {
  eventId: string;
  eventType: string;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;

  constructor() {
    this.eventId = "evt_001";
    this.eventType = "payment.succeeded";
    this.subscriptionId = "sub_001";
    this.invoiceId = "inv_001";
    this.amountCents = 4900;
    this.currency = "USD";
  }

  withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  withType(eventType: string): this {
    this.eventType = eventType;
    return this;
  }

  withSubscription(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  withInvoice(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  withAmount(amountCents: number): this {
    this.amountCents = amountCents;
    return this;
  }

  build(): {
    event_id: string;
    type: string;
    subscription_id: string;
    invoice_id: string;
    amount: number;
    currency: string;
  } {
    return {
      event_id: this.eventId,
      type: this.eventType,
      subscription_id: this.subscriptionId,
      invoice_id: this.invoiceId,
      amount: this.amountCents,
      currency: this.currency,
    };
  }
}
