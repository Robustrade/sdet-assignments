import { randomUUID } from "crypto";
import { PlanId } from "./domain";

export class SubscriptionBuilder {
  private data = {
    customer_id: "cust_001",
    plan: "basic" as PlanId,
    payment_method_id: "pm_test_visa_4242"
  };

  forCustomer(customerId: string): this {
    this.data.customer_id = customerId;
    return this;
  }

  withPlan(plan: PlanId): this {
    this.data.plan = plan;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.data.payment_method_id = paymentMethodId;
    return this;
  }

  build() {
    return { ...this.data };
  }
}

export class WebhookBuilder {
  private data: Record<string, unknown>;

  constructor(subscriptionId: string, invoiceId: string) {
    this.data = {
      event_id: `evt_${randomUUID()}`,
      type: "payment.succeeded",
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount: 4900,
      currency: "USD"
    };
  }

  succeeded(): this {
    this.data.type = "payment.succeeded";
    return this;
  }

  failed(): this {
    this.data.type = "payment.failed";
    return this;
  }

  refunded(): this {
    this.data.type = "payment.refunded";
    return this;
  }

  withEventId(eventId: string): this {
    this.data.event_id = eventId;
    return this;
  }

  build() {
    return { ...this.data };
  }
}
