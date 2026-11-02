import { randomUUID } from "node:crypto";
import {
  Subscription,
  SubscriptionLifecycle,
  type AuditRecord,
  type Invoice,
  type PaymentEvent,
  type Plan,
  type SubscriptionData,
  type SubscriptionStatus,
  type WebhookEventRecord,
} from "./domain.js";
import type { BillingRepository } from "./repository.js";
import type { PaymentProvider } from "./payment-provider.js";

export class BillingError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export interface CreateSubscriptionRequest {
  customerId: string;
  planId: string;
  paymentMethodId: string;
}

export interface BillingServiceOptions {
  repository: BillingRepository;
  paymentProvider: PaymentProvider;
  plans: Plan[];
  clock?: () => Date;
  maxFailedAttempts?: number;
}

export class BillingService {
  private readonly repository: BillingRepository;
  private readonly paymentProvider: PaymentProvider;
  private readonly plans: Map<string, Plan>;
  private readonly clock: () => Date;
  private readonly maxFailedAttempts: number;

  constructor(options: BillingServiceOptions) {
    this.repository = options.repository;
    this.paymentProvider = options.paymentProvider;
    this.plans = new Map(options.plans.map((plan) => [plan.id, { ...plan }]));
    this.clock = options.clock ?? (() => new Date());
    this.maxFailedAttempts = options.maxFailedAttempts ?? 3;
  }

  async createSubscription(
    request: CreateSubscriptionRequest,
  ): Promise<SubscriptionData> {
    if (!request.customerId || !request.planId || !request.paymentMethodId) {
      throw new BillingError(400, "customerId, planId, and paymentMethodId are required");
    }

    const plan = this.plans.get(request.planId);
    if (!plan) {
      throw new BillingError(422, `Unknown plan: ${request.planId}`);
    }
    if (!this.repository.hasCustomer(request.customerId)) {
      throw new BillingError(422, `Unknown customer: ${request.customerId}`);
    }

    const createdAt = this.now();
    const subscriptionId = `sub_${randomUUID()}`;
    const subscription = new Subscription({
      id: subscriptionId,
      customerId: request.customerId,
      planId: plan.id,
      paymentMethodId: request.paymentMethodId,
      status: "trialing",
      trialEndsAt:
        plan.trialDays > 0
          ? new Date(Date.parse(createdAt) + plan.trialDays * 86_400_000).toISOString()
          : null,
      retryCount: 0,
      createdAt,
      updatedAt: createdAt,
    });

    this.repository.addSubscription(subscription.toJSON());
    this.audit(subscription.id, "subscription.created", createdAt, {
      toStatus: "trialing",
    });

    if (plan.trialDays === 0) {
      const invoiceId = `inv_${randomUUID()}`;
      const invoice: Invoice = {
        id: invoiceId,
        subscriptionId,
        amount: plan.amount,
        currency: plan.currency,
        status: "pending",
        attemptCount: 1,
        createdAt,
        updatedAt: createdAt,
      };
      this.repository.addInvoice(invoice);

      const result = await this.paymentProvider.charge({
        customerId: request.customerId,
        paymentMethodId: request.paymentMethodId,
        amount: plan.amount,
        currency: plan.currency,
        reference: invoiceId,
      });

      if (result.outcome === "succeeded") {
        invoice.status = "paid";
        invoice.updatedAt = this.now();
        this.repository.saveInvoice(invoice);
        this.changeStatus(subscription, "active", "payment.succeeded", invoiceId);
      } else {
        invoice.status = result.outcome === "declined" ? "failed" : "pending";
        invoice.updatedAt = this.now();
        this.repository.saveInvoice(invoice);
        subscription.recordFailedAttempt(invoice.updatedAt);
        this.repository.saveSubscription(subscription.toJSON());
        this.changeStatus(subscription, "past_due", `payment.${result.outcome}`, invoiceId);
      }
    }

    return subscription.toJSON();
  }

  getSubscription(subscriptionId: string): SubscriptionData {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) {
      throw new BillingError(404, `Subscription not found: ${subscriptionId}`);
    }
    return subscription;
  }

  cancelSubscription(subscriptionId: string): SubscriptionData {
    const subscription = this.loadSubscription(subscriptionId);
    if (subscription.status === "canceled") {
      throw new BillingError(409, "Subscription is already canceled");
    }
    if (subscription.status === "past_due") {
      throw new BillingError(409, "A past_due subscription cannot be canceled through this operation");
    }

    this.changeStatus(subscription, "canceled", "subscription.canceled");
    return subscription.toJSON();
  }

  changeSubscriptionPlan(
    subscriptionId: string,
    planId: string,
  ): SubscriptionData {
    const subscription = this.loadSubscription(subscriptionId);
    if (!this.plans.has(planId)) {
      throw new BillingError(422, `Unknown plan: ${planId}`);
    }
    if (subscription.status === "canceled" || subscription.status === "past_due") {
      throw new BillingError(409, "Plan cannot be changed in the current subscription state");
    }
    if (subscription.planId === planId) {
      return subscription.toJSON();
    }

    const previousPlanId = subscription.planId;
    const now = this.now();
    subscription.changePlan(planId, now);
    this.repository.saveSubscription(subscription.toJSON());
    this.audit(subscription.id, "subscription.plan_changed", now, {
      referenceId: `${previousPlanId}->${planId}`,
    });
    return subscription.toJSON();
  }

  async processWebhook(event: PaymentEvent): Promise<{
    duplicate: boolean;
    outcome: "processed" | "ignored";
  }> {
    const subscription = this.loadSubscription(event.subscriptionId);
    const plan = this.plans.get(subscription.toJSON().planId);
    if (!plan) {
      throw new BillingError(500, "Subscription references an unknown plan");
    }
    const existingInvoice = this.repository.getInvoice(event.invoiceId);
    if (existingInvoice && existingInvoice.subscriptionId !== event.subscriptionId) {
      throw new BillingError(409, "Invoice belongs to a different subscription");
    }

    const expectedAmount = existingInvoice?.amount ?? plan.amount;
    const expectedCurrency = existingInvoice?.currency ?? plan.currency;
    if (event.amount !== expectedAmount || event.currency !== expectedCurrency) {
      throw new BillingError(422, "Webhook amount or currency does not match the invoice");
    }

    const receivedAt = this.now();
    const existingEvent = this.repository.getWebhookEvent(event.eventId);
    if (existingEvent) {
      existingEvent.deliveryCount += 1;
      existingEvent.duplicateDeliveries += 1;
      this.repository.saveWebhookEvent(existingEvent);
      this.repository.recordWebhookDelivery({
        eventId: event.eventId,
        receivedAt,
        duplicate: true,
      });
      return { duplicate: true, outcome: "ignored" };
    }

    const eventRecord: WebhookEventRecord = {
      eventId: event.eventId,
      type: event.type,
      subscriptionId: event.subscriptionId,
      invoiceId: event.invoiceId,
      firstReceivedAt: receivedAt,
      deliveryCount: 1,
      duplicateDeliveries: 0,
      outcome: "received",
    };
    if (!this.repository.claimWebhook(eventRecord)) {
      throw new Error("Webhook event claim failed unexpectedly");
    }
    this.repository.recordWebhookDelivery({
      eventId: event.eventId,
      receivedAt,
      duplicate: false,
    });

    const outcome = this.applyPaymentEvent(event, subscription, plan);
    eventRecord.outcome = outcome;
    this.repository.saveWebhookEvent(eventRecord);
    return { duplicate: false, outcome };
  }

  private applyPaymentEvent(
    event: PaymentEvent,
    subscription: Subscription,
    plan: Plan,
  ): "processed" | "ignored" {
    const now = this.now();
    let invoice = this.repository.getInvoice(event.invoiceId);
    if (subscription.status === "canceled") {
      return "ignored";
    }

    if (event.type === "payment.refunded") {
      if (!invoice || invoice.status !== "paid") {
        return "ignored";
      }
      invoice.status = "refunded";
      invoice.updatedAt = now;
      this.repository.saveInvoice(invoice);
      this.audit(subscription.id, event.type, now, {
        referenceId: event.invoiceId,
      });
      return "processed";
    }

    if (!invoice) {
      invoice = {
        id: event.invoiceId,
        subscriptionId: event.subscriptionId,
        amount: event.amount,
        currency: event.currency,
        status: "pending",
        attemptCount: Math.max(1, event.attemptNumber ?? 1),
        createdAt: now,
        updatedAt: now,
      };
      this.repository.addInvoice(invoice);
    }

    if (
      event.type === "payment.failed" &&
      (invoice.status === "paid" || invoice.status === "refunded")
    ) {
      return "ignored";
    }
    if (
      event.type === "payment.succeeded" &&
      invoice.status === "refunded"
    ) {
      return "ignored";
    }

    if (event.type === "payment.succeeded") {
      if (invoice.status !== "paid") {
        invoice.status = "paid";
        invoice.updatedAt = now;
        this.repository.saveInvoice(invoice);
      }
      if (subscription.status !== "active") {
        this.changeStatus(subscription, "active", event.type, event.invoiceId);
      }
      subscription.resetFailedAttempts(now);
      this.repository.saveSubscription(subscription.toJSON());
      return "processed";
    }

    if (event.type === "payment.failed") {
      invoice.status = "failed";
      invoice.attemptCount = Math.max(
        invoice.attemptCount + 1,
        event.attemptNumber ?? 0,
      );
      invoice.updatedAt = now;
      this.repository.saveInvoice(invoice);
      subscription.recordFailedAttempt(now);
      this.repository.saveSubscription(subscription.toJSON());

      if (subscription.retryCount >= this.maxFailedAttempts) {
        this.changeStatus(subscription, "canceled", "payment.retries_exhausted", event.invoiceId);
      } else if (subscription.status !== "past_due") {
        this.changeStatus(subscription, "past_due", event.type, event.invoiceId);
      } else {
        this.audit(subscription.id, event.type, now, {
          referenceId: event.invoiceId,
        });
      }
      return "processed";
    }

    return "ignored";
  }

  private loadSubscription(subscriptionId: string): Subscription {
    const data = this.repository.getSubscription(subscriptionId);
    if (!data) {
      throw new BillingError(404, `Subscription not found: ${subscriptionId}`);
    }
    return new Subscription(data);
  }

  private changeStatus(
    subscription: Subscription,
    toStatus: SubscriptionStatus,
    action: string,
    referenceId?: string,
  ): boolean {
    if (subscription.status === toStatus) {
      return false;
    }
    if (!SubscriptionLifecycle.canTransition(subscription.status, toStatus)) {
      return false;
    }

    const fromStatus = subscription.status;
    const now = this.now();
    subscription.transition(toStatus, now);
    this.repository.saveSubscription(subscription.toJSON());
    this.audit(subscription.id, action, now, {
      fromStatus,
      toStatus,
      ...(referenceId === undefined ? {} : { referenceId }),
    });
    return true;
  }

  private audit(
    subscriptionId: string,
    action: string,
    occurredAt: string,
    state: Pick<AuditRecord, "fromStatus" | "toStatus" | "referenceId"> = {},
  ): void {
    this.repository.addAuditRecord({
      id: `audit_${randomUUID()}`,
      subscriptionId,
      action,
      occurredAt,
      ...state,
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }
}
