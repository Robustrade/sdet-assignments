import type { CustomerRepository } from "../repositories/customer-repository.js";
import type { PlanRepository } from "../repositories/plan-repository.js";
import type { SubscriptionRepository } from "../repositories/subscription-repository.js";
import type { InvoiceRepository } from "../repositories/invoice-repository.js";
import type { PaymentRepository } from "../repositories/payment-repository.js";
import type { PaymentProvider } from "../payment/payment-provider.js";
import type { AuditEventRepository } from "../repositories/audit-event-repository.js";

import type { Subscription } from "../domain/subscription.js";
import type { Invoice } from "../domain/invoice.js";
import type { Payment } from "../domain/payment.js";

import { SubscriptionStateMachine } from "../domain/subscription-state.js";

export interface CreateSubscriptionRequest {
  customerId: string;
  planId: "basic" | "pro";
  paymentMethodId: string;
}

export interface CreateSubscriptionResult {
  subscription: Subscription;
  invoice: Invoice;
  payment: Payment;
}

export class SubscriptionService {
  constructor(
  private readonly customerRepository: CustomerRepository,
  private readonly planRepository: PlanRepository,
  private readonly subscriptionRepository: SubscriptionRepository,
  private readonly invoiceRepository: InvoiceRepository,
  private readonly paymentRepository: PaymentRepository,
  private readonly paymentProvider: PaymentProvider,
  private readonly auditEventRepository: AuditEventRepository,
) {}

  async createSubscription(
    request: CreateSubscriptionRequest,
  ): Promise<CreateSubscriptionResult> {
    const customer = this.customerRepository.findById(request.customerId);

    if (!customer) {
      throw new Error(`Customer not found: ${request.customerId}`);
    }

    const plan = this.planRepository.findById(request.planId);

    if (!plan) {
      throw new Error(`Plan not found: ${request.planId}`);
    }

    if (!request.paymentMethodId) {
      throw new Error("Payment method is required");
    }

    const subscriptionId = `sub_${crypto.randomUUID()}`;
    const invoiceId = `inv_${crypto.randomUUID()}`;
    const paymentId = `pay_${crypto.randomUUID()}`;

    const now = new Date();

    const subscription: Subscription = {
      id: subscriptionId,
      customerId: customer.id,
      planId: plan.id,
      paymentMethodId: request.paymentMethodId,
      state: "trialing",
      createdAt: now,
    };

    this.subscriptionRepository.save(subscription);

    const invoice: Invoice = {
      id: invoiceId,
      subscriptionId,
      amountCents: plan.priceCents,
      currency: plan.currency,
      status: "pending",
      createdAt: now,
    };

    this.invoiceRepository.save(invoice);

    const chargeResult = await this.paymentProvider.charge({
      customerId: customer.id,
      paymentMethodId: request.paymentMethodId,
      amountCents: plan.priceCents,
      currency: plan.currency,
      idempotencyKey: invoiceId,
    });

    const payment: Payment = {
      id: paymentId,
      invoiceId,
      subscriptionId,
      amountCents: plan.priceCents,
      currency: plan.currency,
      status: chargeResult.success ? "succeeded" : "failed",
      providerReference: chargeResult.providerReference,
      createdAt: now,
    };

    this.paymentRepository.save(payment);

    invoice.status = chargeResult.success ? "paid" : "failed";
    this.invoiceRepository.save(invoice);

    const stateMachine = new SubscriptionStateMachine(
      subscription.state,
    );

    subscription.state = stateMachine.transition(
      chargeResult.success
        ? "payment.succeeded"
        : "payment.failed",
    );

    this.subscriptionRepository.save(subscription);

    return {
      subscription,
      invoice,
      payment,
    };
  }

  getSubscription(subscriptionId: string): Subscription {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error(
        `Subscription not found: ${subscriptionId}`,
      );
    }

    return subscription;
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Subscription> {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error(
        `Subscription not found: ${subscriptionId}`,
      );
    }

    const previousState = subscription.state;

const nextState = new SubscriptionStateMachine(
  subscription.state,
).transition("cancel");

subscription.state = nextState;
subscription.canceledAt = new Date();

this.subscriptionRepository.save(subscription);

this.auditEventRepository.save({
  id: `audit_${crypto.randomUUID()}`,
  subscriptionId: subscription.id,
  eventType: "subscription.canceled",
  previousState,
  nextState,
  createdAt: new Date(),
});

return subscription;
  }
}