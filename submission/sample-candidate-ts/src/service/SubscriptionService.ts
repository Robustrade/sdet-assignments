import { randomUUID } from "crypto";
import { PLANS, PlanId, Subscription, WebhookEventPayload } from "../domain/types";
import { canTransition, transition } from "../domain/subscriptionStateMachine";
import { PaymentProvider } from "../payments/PaymentProvider";
import { Repository } from "../persistence/Repository";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export interface CreateSubscriptionInput {
  customerId: unknown;
  plan: unknown;
  paymentMethodId: unknown;
}

export interface WebhookResult {
  applied: boolean;
  reason?: string;
}

/**
 * Workflow layer: orchestrates validation, the state machine, persistence,
 * and the (mockable) payment provider. This is the seam unit tests should
 * target directly with a fake Repository/PaymentProvider, separate from
 * the HTTP-level tests that go through the Express app.
 */
export class SubscriptionService {
  constructor(
    private readonly repository: Repository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<{ subscription: Subscription; invoiceId: string }> {
    const { customerId, plan, paymentMethodId } = this.validateCreateInput(input);
    const planConfig = PLANS[plan];

    const now = new Date().toISOString();
    const subscriptionId = `sub_${randomUUID()}`;
    const invoiceId = `inv_${randomUUID()}`;

    const subscription: Subscription = {
      id: subscriptionId,
      customerId,
      plan,
      paymentMethodId,
      status: "trialing",
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.repository.saveSubscription(subscription);
    this.repository.saveInvoice({
      id: invoiceId,
      subscriptionId,
      amountCents: planConfig.priceCents,
      currency: planConfig.currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    this.repository.recordAuditEvent(subscriptionId, "subscription_created", plan);

    if (planConfig.trialDays === 0) {
      // No trial: the first invoice is due immediately, so we charge
      // synchronously here rather than waiting for a webhook.
      const result = await this.paymentProvider.charge({
        customerId,
        paymentMethodId,
        amountCents: planConfig.priceCents,
        currency: planConfig.currency,
        reference: invoiceId,
      });

      const trigger = result.outcome === "succeeded" ? "first_charge_succeeded" : "first_charge_failed";
      const nextState = transition(subscription.status, trigger);
      this.repository.updateSubscriptionStatus(subscriptionId, nextState, 0);
      this.repository.updateInvoiceStatus(invoiceId, result.outcome === "succeeded" ? "paid" : "failed");
      this.repository.recordAuditEvent(
        subscriptionId,
        result.outcome === "succeeded" ? "first_charge_succeeded" : "first_charge_failed",
        invoiceId,
      );
      subscription.status = nextState;
    }
    // Trial plans stay "trialing" with a pending invoice; trial-end billing
    // arrives later as a payment.succeeded/payment.failed webhook for that
    // same invoice, same as any recurring charge.

    return { subscription: this.mustGetSubscription(subscriptionId), invoiceId };
  }

  cancelSubscription(subscriptionId: string): Subscription {
    const subscription = this.mustGetSubscription(subscriptionId);
    if (!canTransition(subscription.status, "customer_canceled")) {
      throw new ConflictError(`subscription ${subscriptionId} is already ${subscription.status}`);
    }
    const nextState = transition(subscription.status, "customer_canceled");
    this.repository.updateSubscriptionStatus(subscriptionId, nextState, subscription.consecutiveFailures);
    this.repository.recordAuditEvent(subscriptionId, "subscription_canceled", "customer_canceled");
    return this.mustGetSubscription(subscriptionId);
  }

  /**
   * Opens a new pending invoice for a subscription's next billing cycle.
   * Stands in for whatever triggers periodic billing in a real system
   * (out of scope here — see Non-Goals). Not exposed over HTTP; call it
   * directly to set up recurring-billing scenarios in tests, the same way
   * a scheduler would before asking the payment provider to charge it.
   */
  openNextInvoice(subscriptionId: string): { invoiceId: string } {
    const subscription = this.mustGetSubscription(subscriptionId);
    const planConfig = PLANS[subscription.plan];
    const now = new Date().toISOString();
    const invoiceId = `inv_${randomUUID()}`;
    this.repository.saveInvoice({
      id: invoiceId,
      subscriptionId,
      amountCents: planConfig.priceCents,
      currency: planConfig.currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { invoiceId };
  }

  getSubscription(subscriptionId: string): Subscription {
    return this.mustGetSubscription(subscriptionId);
  }

  /** Applies an inbound, already-signature-verified webhook event. Idempotent
   * on `eventId` and safe against stale/out-of-order delivery. */
  async handleWebhookEvent(payload: WebhookEventPayload): Promise<WebhookResult> {
    if (this.repository.hasProcessedWebhookEvent(payload.eventId)) {
      return { applied: false, reason: "duplicate_event" };
    }

    const subscription = this.repository.getSubscription(payload.subscriptionId);
    const invoice = this.repository.getInvoice(payload.invoiceId);
    if (!subscription || !invoice) {
      throw new NotFoundError("unknown subscription or invoice referenced by webhook");
    }

    let result: WebhookResult;

    if (subscription.status === "canceled") {
      this.repository.recordAuditEvent(subscription.id, "webhook_ignored_terminal_state", payload.type);
      result = { applied: false, reason: "subscription_canceled" };
    } else if (payload.type === "payment.succeeded") {
      result = this.applyPaymentSucceeded(subscription, invoice.id);
    } else if (payload.type === "payment.failed") {
      result = this.applyPaymentFailed(subscription, invoice.id);
    } else {
      // payment.refunded: recorded, but does not drive the lifecycle state.
      this.repository.updateInvoiceStatus(invoice.id, "refunded");
      this.repository.recordAuditEvent(subscription.id, "payment_refunded", invoice.id);
      result = { applied: true };
    }

    this.repository.markWebhookEventProcessed(payload.eventId);
    return result;
  }

  private applyPaymentSucceeded(subscription: Subscription, invoiceId: string): WebhookResult {
    const invoice = this.repository.getInvoice(invoiceId)!;
    if (invoice.status === "paid") {
      return { applied: false, reason: "invoice_already_paid" };
    }

    const trigger = subscription.status === "past_due" ? "recurring_charge_succeeded" : "first_charge_succeeded";
    if (!canTransition(subscription.status, trigger)) {
      this.repository.recordAuditEvent(subscription.id, "webhook_ignored_invalid_transition", trigger);
      return { applied: false, reason: "invalid_transition" };
    }

    const nextState = transition(subscription.status, trigger);
    this.repository.updateSubscriptionStatus(subscription.id, nextState, 0);
    this.repository.updateInvoiceStatus(invoiceId, "paid");
    this.repository.recordAuditEvent(subscription.id, "payment_succeeded", invoiceId);
    return { applied: true };
  }

  private applyPaymentFailed(subscription: Subscription, invoiceId: string): WebhookResult {
    const invoice = this.repository.getInvoice(invoiceId)!;
    if (invoice.status === "paid" || invoice.status === "refunded") {
      // Stale/out-of-order: a failure notification for an invoice that has
      // already been resolved must not regress the subscription.
      this.repository.recordAuditEvent(subscription.id, "webhook_ignored_stale", invoiceId);
      return { applied: false, reason: "invoice_already_resolved" };
    }

    const planConfig = PLANS[subscription.plan];
    const failures = subscription.consecutiveFailures + 1;

    if (subscription.status === "past_due" && failures >= planConfig.maxPaymentRetries) {
      const nextState = transition(subscription.status, "retries_exhausted");
      this.repository.updateSubscriptionStatus(subscription.id, nextState, failures);
      this.repository.updateInvoiceStatus(invoiceId, "failed");
      this.repository.recordAuditEvent(subscription.id, "retries_exhausted", invoiceId);
      return { applied: true };
    }

    if (subscription.status === "past_due") {
      // Still within retry budget: stays past_due, just tracks the failure.
      this.repository.updateSubscriptionStatus(subscription.id, "past_due", failures);
      this.repository.updateInvoiceStatus(invoiceId, "failed");
      this.repository.recordAuditEvent(subscription.id, "payment_failed", invoiceId);
      return { applied: true };
    }

    const trigger = subscription.status === "trialing" ? "first_charge_failed" : "recurring_charge_failed";
    if (!canTransition(subscription.status, trigger)) {
      this.repository.recordAuditEvent(subscription.id, "webhook_ignored_invalid_transition", trigger);
      return { applied: false, reason: "invalid_transition" };
    }

    const nextState = transition(subscription.status, trigger);
    this.repository.updateSubscriptionStatus(subscription.id, nextState, failures);
    this.repository.updateInvoiceStatus(invoiceId, "failed");
    this.repository.recordAuditEvent(subscription.id, "payment_failed", invoiceId);
    return { applied: true };
  }

  private validateCreateInput(input: CreateSubscriptionInput): {
    customerId: string;
    plan: PlanId;
    paymentMethodId: string;
  } {
    const missing: string[] = [];
    if (typeof input.customerId !== "string" || input.customerId.length === 0) missing.push("customerId");
    if (typeof input.paymentMethodId !== "string" || input.paymentMethodId.length === 0) {
      missing.push("paymentMethodId");
    }
    if (typeof input.plan !== "string" || input.plan.length === 0) missing.push("plan");
    if (missing.length > 0) {
      throw new ValidationError("missing fields", missing);
    }
    if (!(input.plan as string in PLANS)) {
      throw new ValidationError(`unknown plan: ${input.plan}`);
    }
    return {
      customerId: input.customerId as string,
      plan: input.plan as PlanId,
      paymentMethodId: input.paymentMethodId as string,
    };
  }

  private mustGetSubscription(id: string): Subscription {
    const subscription = this.repository.getSubscription(id);
    if (!subscription) throw new NotFoundError(`subscription ${id} not found`);
    return subscription;
  }
}
