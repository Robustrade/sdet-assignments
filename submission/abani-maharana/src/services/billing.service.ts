import { Payment, Plan, Subscription, WebhookEvent } from "../domain/types";

import {
  SubscriptionEvent,
  SubscriptionStateMachine,
} from "../domain/subscription";

import { InMemorySubscriptionRepository } from "../repositories/in-memory.repository";

import { PaymentProvider } from "../providers/payment-provider";

export interface CreateSubscriptionInput {
  customerId: string;
  paymentMethodId: string;
  plan: Plan["name"];
}

const PLANS: Record<Plan["name"], Plan> = {
  basic: {
    name: "basic",
    price: 999,
    trialDays: 7,
  },

  pro: {
    name: "pro",
    price: 4900,
    trialDays: 14,
  },
};

export class BillingService {
  constructor(
    private readonly repository: InMemorySubscriptionRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly stateMachine: SubscriptionStateMachine,
  ) {}

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<Subscription> {
    const plan = PLANS[input.plan];

    if (!plan) {
      throw new Error("Unknown plan");
    }

    const subscription: Subscription = {
      id: crypto.randomUUID(),
      customerId: input.customerId,
      paymentMethodId: input.paymentMethodId,
      plan: input.plan,
      status: "trialing",
    };

    this.repository.saveSubscription(subscription);

    try {
      const paymentResult = await this.paymentProvider.charge({
        customerId: input.customerId,
        paymentMethodId: input.paymentMethodId,
        amount: plan.price,
        currency: "USD",
        idempotencyKey: `initial-charge-${subscription.id}`,
      });

      const event: SubscriptionEvent = paymentResult.success
        ? "first_charge_succeeded"
        : "first_charge_failed";

      this.applyTransition(subscription, event);

      const payment: Payment = {
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        invoiceId: `inv_${subscription.id}`,
        amount: plan.price,
        status: paymentResult.success ? "succeeded" : "failed",
        reference: paymentResult.reference,
      };

      this.repository.savePayment(payment);

      return subscription;
    } catch (error) {
      this.repository.saveSubscription(subscription);

      throw error;
    }
  }

  getSubscription(id: string): Subscription | undefined {
    return this.repository.findSubscriptionById(id);
  }

  cancelSubscription(id: string): Subscription {
    const subscription = this.requireSubscription(id);

    this.applyTransition(subscription, "customer_canceled");

    return subscription;
  }

  processWebhook(event: WebhookEvent): {
    duplicate: boolean;
    subscription: Subscription;
  } {
    /*
     * Always resolve the subscription first.
     */
    const subscription = this.requireSubscription(event.subscriptionId);

    /*
     * Idempotency:
     *
     * If this event_id has already been processed,
     * do not process it again.
     */
    if (this.repository.hasWebhookEvent(event.eventId)) {
      return {
        duplicate: true,
        subscription,
      };
    }

    /*
     * A canceled subscription must never be
     * reactivated by a successful payment webhook.
     *
     * This is an invalid lifecycle transition,
     * so let the route convert it to HTTP 409.
     */
    if (
      subscription.status === "canceled" &&
      event.type === "payment.succeeded"
    ) {
      throw new Error(
        "Invalid subscription transition: canceled + payment.succeeded",
      );
    }

    /*
     * Persist the webhook event exactly once.
     */
    this.repository.saveWebhookEvent(event);

    const existingPayment = this.repository.findPaymentByInvoiceId(
      event.invoiceId,
    );

    /*
     * payment.refunded is intentionally lifecycle-neutral.
     *
     * It must not reactivate, cancel, or otherwise
     * change the subscription state.
     */
    if (event.type === "payment.refunded") {
      this.repository.saveAuditEvent({
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        type: event.type,
        eventId: event.eventId,
      });

      return {
        duplicate: false,
        subscription,
      };
    }

    /*
     * Out-of-order protection.
     *
     * If the same invoice already succeeded,
     * a later payment.failed event must not
     * move ACTIVE back to PAST_DUE.
     */
    if (
      existingPayment?.status === "succeeded" &&
      event.type === "payment.failed"
    ) {
      this.repository.saveAuditEvent({
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        type: "stale_webhook_ignored",
        eventId: event.eventId,
      });

      return {
        duplicate: false,
        subscription,
      };
    }

    let transitionEvent: SubscriptionEvent | undefined;

    if (event.type === "payment.succeeded") {
      if (subscription.status === "trialing") {
        transitionEvent = "first_charge_succeeded";
      } else if (subscription.status === "past_due") {
        transitionEvent = "retry_succeeded";
      }
    }

    if (event.type === "payment.failed") {
      if (subscription.status === "trialing") {
        transitionEvent = "first_charge_failed";
      } else if (subscription.status === "active") {
        transitionEvent = "recurring_charge_failed";
      }
    }

    /*
     * Only perform a lifecycle transition
     * when the current state/event combination
     * requires one.
     */
    if (transitionEvent) {
      this.applyTransition(subscription, transitionEvent);
    }

    /*
     * Persist one payment per invoice.
     */
    if (!existingPayment) {
      const payment: Payment = {
        id: crypto.randomUUID(),
        subscriptionId: subscription.id,
        invoiceId: event.invoiceId,
        amount: event.amount,
        status: event.type === "payment.succeeded" ? "succeeded" : "failed",
        reference: event.eventId,
      };

      this.repository.savePayment(payment);
    }

    return {
      duplicate: false,
      subscription,
    };
  }

  private requireSubscription(id: string): Subscription {
    const subscription = this.repository.findSubscriptionById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    return subscription;
  }

  private applyTransition(
    subscription: Subscription,
    event: SubscriptionEvent,
  ): void {
    const previousStatus = subscription.status;

    const nextStatus = this.stateMachine.transition(previousStatus, event);

    subscription.status = nextStatus;

    this.repository.saveSubscription(subscription);

    this.repository.saveAuditEvent({
      id: crypto.randomUUID(),
      subscriptionId: subscription.id,
      type: event,
      fromStatus: previousStatus,
      toStatus: nextStatus,
    });
  }
}
