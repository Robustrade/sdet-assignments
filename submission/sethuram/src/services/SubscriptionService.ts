import { randomUUID } from "crypto";
import { Subscription } from "../domain/Subscription";
import {
  SubscriptionStateMachine,
  SubscriptionStatus
} from "../domain/SubscriptionStateMachine";
import { SubscriptionRepository } from "../repositories/SubscriptionRepository";
import { PlanCatalog } from "../domain/Plan";
import { CustomerCatalog } from "../domain/Customer";
import { InvoiceRepository } from "../repositories/InvoiceRepository";
import { InMemoryInvoiceRepository } from "../repositories/InMemoryInvoiceRepository";

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly stateMachine: SubscriptionStateMachine,
    private readonly planCatalog: PlanCatalog = new PlanCatalog(),
    private readonly customerCatalog: CustomerCatalog = new CustomerCatalog(),
    private readonly invoiceRepository: InvoiceRepository =
      new InMemoryInvoiceRepository()
  ) { }

  async createSubscription(
    customerId: string,
    planId: string
  ): Promise<Subscription> {
    if (
      typeof customerId !== "string" ||
      typeof planId !== "string" ||
      !customerId.trim() ||
      !planId.trim()
    ) {
      throw new Error("Customer ID and Plan ID are required");
    }

    // Validate the plan before creating a subscription.
    const plan = this.planCatalog.getPlan(planId);
    // Validate the customer before persisting a subscription.
    if (!this.customerCatalog.exists(customerId)) {
      throw new Error("Unknown customer");
    }
    const now = new Date();

    const trialEndsAt = plan.trialDays > 0
      ? new Date(
        now.getTime() +
        plan.trialDays * 24 * 60 * 60 * 1000
      )
      : undefined;

    const subscription: Subscription = {
      id: randomUUID(),
      customerId,
      planId,
      status: "trialing",
      failedPaymentAttempts: 0,
      ...(trialEndsAt ? { trialEndsAt } : {}),
      createdAt: now,
      updatedAt: now
    };

    await this.repository.save(subscription);

    return subscription;
  }

  async getSubscription(
    id: string
  ): Promise<Subscription | null> {
    return this.repository.findById(id);
  }
  async changePlan(
    id: string,
    planId: string
  ): Promise<Subscription> {
    if (
      typeof planId !== "string" ||
      !planId.trim()
    ) {
      throw new Error("Plan ID is required");
    }

    const subscription = await this.repository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (subscription.status === "canceled") {
      throw new Error("Canceled subscription cannot change plan");
    }

    this.planCatalog.getPlan(planId);

    if (subscription.planId === planId) {
      return subscription;
    }

    const updated: Subscription = {
      ...subscription,
      planId,
      updatedAt: new Date()
    };

    await this.repository.save(updated);

    return updated;
  }
  private async ensureSuccessfulPayment(
    subscriptionId: string
  ): Promise<void> {
    const invoices =
      await this.invoiceRepository.findBySubscriptionId(
        subscriptionId
      );

    const hasSuccessfulPayment = invoices.some(
      invoice =>
        invoice.status === "paid" ||
        invoice.status === "refunded"
    );

    if (!hasSuccessfulPayment) {
      throw new Error(
        "Cannot activate subscription without a successful payment"
      );
    }
  }
  async recordPaymentOutcome(
    id: string,
    succeeded: boolean
  ): Promise<Subscription> {
    const subscription = await this.repository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (subscription.status === "canceled") {
      return subscription;
    }
    if (succeeded) {
      await this.ensureSuccessfulPayment(id);
    }
    const failedPaymentAttempts = succeeded
      ? 0
      : (subscription.failedPaymentAttempts ?? 0) + 1;

    const maxFailedAttempts = 3;

    const nextStatus: SubscriptionStatus = succeeded
      ? "active"
      : failedPaymentAttempts >= maxFailedAttempts
        ? "canceled"
        : "past_due";

    const status =
      subscription.status === nextStatus
        ? subscription.status
        : this.stateMachine.transition(
          subscription.status,
          nextStatus
        );

    const updated: Subscription = {
      ...subscription,
      status,
      failedPaymentAttempts,
      updatedAt: new Date()
    };

    await this.repository.save(updated);

    return updated;
  }


  async changeStatus(
    id: string,
    nextStatus: SubscriptionStatus
  ): Promise<Subscription> {
    const subscription = await this.repository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const status = this.stateMachine.transition(
      subscription.status,
      nextStatus
    );
    if (nextStatus === "active") {
      await this.ensureSuccessfulPayment(id);
    }

    const updated: Subscription = {
      ...subscription,
      status,
      updatedAt: new Date()
    };

    await this.repository.save(updated);

    return updated;
  }
}