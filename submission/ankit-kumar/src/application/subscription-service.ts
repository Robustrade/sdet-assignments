import { randomUUID } from "node:crypto";
import {
  PaymentProviderTimeoutError,
  type PaymentProvider
} from "../domain/payment-provider";
import { SubscriptionStateMachine } from "../domain/subscription-state-machine";
import type { Subscription } from "../infrastructure/subscription-repository";
import { CustomerRepository } from "../infrastructure/customer-repository";
import { SubscriptionRepository } from "../infrastructure/subscription-repository";
import { InvoiceRepository } from "../infrastructure/invoice-repository";
import { AuditRepository } from "../infrastructure/audit-repository";

const PLAN_CONFIG = {
  basic: {
    price: 1900,
    currency: "USD",
    trialDays: 7
  },
  pro: {
    price: 4900,
    currency: "USD",
    trialDays: 0
  }
} as const;

export interface CreateSubscriptionRequest {
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

interface SubscriptionServiceDependencies {
  customerRepository: CustomerRepository;
  subscriptionRepository: SubscriptionRepository;
  paymentProvider: PaymentProvider;
  invoiceRepository?: InvoiceRepository;
  auditRepository?: AuditRepository;
  now?: () => Date;
}

export class SubscriptionService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: SubscriptionServiceDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  private recordAudit(
    subscriptionId: string,
    eventType: string,
    previousStatus: Subscription["status"] | null,
    newStatus: Subscription["status"] | null
  ): void {
    this.dependencies.auditRepository?.save({
      id: `audit_${randomUUID()}`,
      subscriptionId,
      eventType,
      previousStatus,
      newStatus,
      occurredAt: this.now().toISOString()
    });
  }

  async createSubscription(
    request: CreateSubscriptionRequest
  ): Promise<Subscription> {
    const customer = this.dependencies.customerRepository.findById(
      request.customerId
    );

    if (!customer) {
      throw new Error("Customer not found");
    }

    if (!request.paymentMethodId?.trim()) {
      throw new Error("Payment method is required");
    }

    const plan =
      PLAN_CONFIG[request.plan as keyof typeof PLAN_CONFIG];

    if (!plan) {
      throw new Error("Invalid plan");
    }

    const createdAt = this.now();
    const trialEndsAt = new Date(createdAt);

    if (plan.trialDays > 0) {
      trialEndsAt.setUTCDate(
        trialEndsAt.getUTCDate() + plan.trialDays
      );
    }

    const subscription: Subscription = {
      id: `sub_${randomUUID()}`,
      customerId: customer.id,
      plan: request.plan,
      paymentMethodId: request.paymentMethodId,
      status: "trialing",
      ...(plan.trialDays > 0
        ? { trialEndsAt: trialEndsAt.toISOString() }
        : {}),
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString()
    };

    this.dependencies.subscriptionRepository.save(subscription);

    this.recordAudit(
      subscription.id,
      "subscription.created",
      null,
      "trialing"
    );

    // Basic starts with a trial. Pro is charged immediately.
    if (plan.trialDays === 0) {
      const invoiceId = `inv_${randomUUID()}`;
      const idempotencyKey = `${subscription.id}_initial_charge`;

      this.dependencies.invoiceRepository?.save({
        id: invoiceId,
        subscriptionId: subscription.id,
        amount: plan.price,
        currency: plan.currency,
        status: "pending",
        idempotencyKey,
        createdAt: this.now().toISOString()
      });

      let paymentStatus: "succeeded" | "failed";
      let providerReference: string | undefined;
      let failureCode: string | undefined;

      try {
        const result = await this.dependencies.paymentProvider.charge({
          customerId: customer.id,
          paymentMethodId: request.paymentMethodId,
          amount: plan.price,
          currency: plan.currency,
          idempotencyKey
        });

        paymentStatus =
          result.outcome === "succeeded" ? "succeeded" : "failed";

        providerReference = result.providerReference;
        failureCode = result.failureCode;
      } catch (error) {
        paymentStatus = "failed";
        failureCode =
          error instanceof PaymentProviderTimeoutError
            ? "provider_timeout"
            : error instanceof Error
              ? error.name
              : "payment_error";
      }

      const paymentEvent =
        paymentStatus === "succeeded"
          ? "payment.succeeded"
          : "payment.failed";

      const nextStatus = SubscriptionStateMachine.transition(
        subscription.status,
        paymentEvent
      );

      this.dependencies.invoiceRepository?.updatePaymentResult(
        invoiceId,
        paymentStatus,
        providerReference,
        failureCode
      );

      this.dependencies.subscriptionRepository.updateStatus(
        subscription.id,
        nextStatus,
        this.now().toISOString()
      );

      this.recordAudit(
        subscription.id,
        paymentEvent,
        subscription.status,
        nextStatus
      );
    }

    const savedSubscription =
      this.dependencies.subscriptionRepository.findById(subscription.id);

    if (!savedSubscription) {
      throw new Error("Subscription could not be retrieved after creation");
    }

    return savedSubscription;
  }

  cancelSubscription(id: string): Subscription {
    const subscription =
      this.dependencies.subscriptionRepository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const nextStatus = SubscriptionStateMachine.transition(
      subscription.status,
      "customer.cancelled"
    );

    this.dependencies.subscriptionRepository.updateStatus(
      id,
      nextStatus,
      this.now().toISOString()
    );

    this.recordAudit(
      id,
      "customer.cancelled",
      subscription.status,
      nextStatus
    );

    const updatedSubscription =
      this.dependencies.subscriptionRepository.findById(id);

    if (!updatedSubscription) {
      throw new Error("Subscription not found after cancellation");
    }

    return updatedSubscription;
  }
}