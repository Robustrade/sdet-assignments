import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Invoice,
  PaymentEvent,
  PLANS,
  Subscription,
  SubscriptionBuilder,
  SubscriptionState,
  SubscriptionStateMachine,
} from "./domain.ts";
import { SubscriptionRepository } from "./repository.ts";
import type { PaymentProvider } from "./payment.ts";

interface BillingServiceOptions {
  dbPath: string;
  paymentProvider?: PaymentProvider | null;
  signatureSecret?: string;
}

interface WebhookPayload {
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id?: string | null;
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

type SubscriptionJson = ReturnType<Subscription["toJSON"]>;
type WebhookResult =
  | { status: "duplicate"; event_id: string }
  | { status: "processed"; subscription_id: string; state: SubscriptionState };

export class ValidationError extends Error {}
export class SignatureError extends Error {}
export class UnknownSubscriptionError extends Error {}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export class BillingService {
  readonly repository: SubscriptionRepository;
  readonly paymentProvider: PaymentProvider | null;
  readonly signatureSecret: string;
  private readonly stateMachine: SubscriptionStateMachine;

  constructor({ dbPath, paymentProvider = null, signatureSecret = "test-secret" }: BillingServiceOptions) {
    this.repository = new SubscriptionRepository(dbPath);
    this.paymentProvider = paymentProvider;
    this.signatureSecret = signatureSecret;
    this.stateMachine = new SubscriptionStateMachine();
  }

  createSubscription(
    customerId: unknown,
    planName: unknown,
    paymentMethodId: unknown,
  ): SubscriptionJson {
    const normalizedPlanName = normalizeNonEmptyString(planName);
    const normalizedCustomerId = normalizeNonEmptyString(customerId);
    const normalizedPaymentMethodId = normalizeNonEmptyString(paymentMethodId);

    if (!normalizedPlanName || !PLANS[normalizedPlanName]) {
      throw new ValidationError(`Unknown plan: ${planName}`);
    }
    if (!normalizedCustomerId || !normalizedPaymentMethodId) {
      throw new ValidationError("customer_id and payment_method_id are required");
    }

    const plan = PLANS[normalizedPlanName];
    const subscription = new SubscriptionBuilder()
      .withCustomer(normalizedCustomerId)
      .withPlan(normalizedPlanName)
      .withPaymentMethod(normalizedPaymentMethodId)
      .withId(this.nextSubscriptionId())
      .build();

    this.repository.createSubscription(subscription);
    if (plan.immediateCharge && this.paymentProvider) {
      this.chargeCustomer(subscription);
    }
    return subscription.toJSON();
  }

  getSubscription(subscriptionId: string): SubscriptionJson {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) {
      throw new UnknownSubscriptionError(`Unknown subscription ${subscriptionId}`);
    }
    return subscription.toJSON();
  }

  cancelSubscription(subscriptionId: string): SubscriptionJson {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) {
      throw new UnknownSubscriptionError(`Unknown subscription ${subscriptionId}`);
    }
    subscription.state = this.stateMachine.transition(
      subscription.state,
      SubscriptionState.CANCELED,
    );
    this.repository.updateSubscription(subscription);
    return subscription.toJSON();
  }

  chargeCustomer(subscription: Subscription): boolean {
    if (!this.paymentProvider) {
      return true;
    }
    return this.paymentProvider.charge(
      subscription.customerId,
      subscription.paymentMethodId,
      subscription.priceCents,
      "USD",
    );
  }

  handleWebhook(rawBody: Buffer, signature: unknown): WebhookResult {
    if (typeof signature !== "string" || !signature) {
      throw new SignatureError("Missing X-Provider-Signature header");
    }
    const expected = createHmac("sha256", this.signatureSecret).update(rawBody).digest();
    let supplied;
    try {
      supplied = Buffer.from(signature, "hex");
    } catch {
      throw new SignatureError("Invalid signature");
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new SignatureError("Invalid signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ValidationError("Malformed webhook payload");
    }
    if (!this.isWebhookPayload(payload)) {
      throw new ValidationError("Malformed webhook payload");
    }

    if (this.repository.eventExists(payload.event_id)) {
      return { status: "duplicate", event_id: payload.event_id };
    }

    const subscription = this.repository.getSubscription(payload.subscription_id);
    if (!subscription) {
      throw new UnknownSubscriptionError(`Unknown subscription ${payload.subscription_id}`);
    }

    const amount = payload.amount ?? 0;
    const currency = normalizeNonEmptyString(payload.currency) ?? "USD";
    const invoiceId = normalizeNonEmptyString(payload.invoice_id) ?? `inv_${payload.event_id}`;
    if (!invoiceId) {
      throw new ValidationError("Malformed webhook payload");
    }

    const nextState = this.stateForEvent(subscription.state, payload.type);
    subscription.state = nextState;

    this.repository.db.exec("BEGIN");
    try {
      this.repository.updateSubscription(subscription);
      this.repository.recordInvoice(new Invoice({
        id: invoiceId,
        subscriptionId: payload.subscription_id,
        amountCents: amount,
        currency,
        status: payload.type === "payment.succeeded" ? "paid" : "failed",
      }));
      this.repository.recordPaymentEvent(new PaymentEvent({
        eventId: payload.event_id,
        subscriptionId: payload.subscription_id,
        eventType: payload.type,
        invoiceId,
        amountCents: amount,
        currency,
      }), payload);
      this.repository.db.exec("COMMIT");
    } catch (error) {
      this.repository.db.exec("ROLLBACK");
      throw error;
    }

    return {
      status: "processed",
      subscription_id: payload.subscription_id,
      state: nextState,
    };
  }

  stateForEvent(currentState: SubscriptionState, eventType: string): SubscriptionState {
    if (eventType === "payment.succeeded") {
      return this.stateMachine.transition(currentState, SubscriptionState.ACTIVE);
    }
    if (eventType === "payment.failed") {
      return this.stateMachine.transition(currentState, SubscriptionState.PAST_DUE);
    }
    if (eventType === "payment.refunded") {
      return this.stateMachine.transition(currentState, SubscriptionState.CANCELED);
    }
    throw new ValidationError(`Unsupported event type: ${eventType}`);
  }

  nextSubscriptionId(): string {
    let count = 1;
    while (this.repository.getSubscription(`sub_${String(count).padStart(3, "0")}`)) {
      count += 1;
    }
    return `sub_${String(count).padStart(3, "0")}`;
  }

  private isWebhookPayload(payload: unknown): payload is WebhookPayload {
    if (!(payload && typeof payload === "object" && !Array.isArray(payload))) {
      return false;
    }

    const eventId = normalizeNonEmptyString((payload as Record<string, unknown>).event_id);
    const type = normalizeNonEmptyString((payload as Record<string, unknown>).type);
    const subscriptionId = normalizeNonEmptyString((payload as Record<string, unknown>).subscription_id);
    const amount = (payload as Record<string, unknown>).amount;
    const invoiceId = (payload as Record<string, unknown>).invoice_id;
    const currency = (payload as Record<string, unknown>).currency;

    if (!eventId || !type || !subscriptionId) {
      return false;
    }
    if (amount !== undefined && !(typeof amount === "number" && Number.isInteger(amount) && amount >= 0)) {
      return false;
    }
    if (invoiceId !== undefined && invoiceId !== null && normalizeNonEmptyString(invoiceId) === null) {
      return false;
    }
    if (currency !== undefined && currency !== null && normalizeNonEmptyString(currency) === null) {
      return false;
    }
    return true;
  }
}
