import type { PaymentEvent } from "../src/domain.js";
import type { CreateSubscriptionRequest } from "../src/billing-service.js";

export class SubscriptionRequestBuilder {
  private readonly request: CreateSubscriptionRequest = {
    customerId: "cust_001",
    planId: "basic",
    paymentMethodId: "pm_test_visa_4242",
  };

  withCustomer(customerId: string): this {
    this.request.customerId = customerId;
    return this;
  }

  withPlan(planId: string): this {
    this.request.planId = planId;
    return this;
  }

  withPaymentMethod(paymentMethodId: string): this {
    this.request.paymentMethodId = paymentMethodId;
    return this;
  }

  build(): CreateSubscriptionRequest {
    return { ...this.request };
  }

  toApiPayload(): Record<string, string> {
    return {
      customer_id: this.request.customerId,
      plan: this.request.planId,
      payment_method_id: this.request.paymentMethodId,
    };
  }
}

export class PaymentWebhookBuilder {
  private readonly event: PaymentEvent = {
    eventId: "evt_test_001",
    type: "payment.succeeded",
    subscriptionId: "sub_test_001",
    invoiceId: "inv_test_001",
    amount: 9900,
    currency: "USD",
  };

  withEventId(eventId: string): this {
    this.event.eventId = eventId;
    return this;
  }

  withType(type: PaymentEvent["type"]): this {
    this.event.type = type;
    return this;
  }

  withSubscription(subscriptionId: string): this {
    this.event.subscriptionId = subscriptionId;
    return this;
  }

  withInvoice(invoiceId: string): this {
    this.event.invoiceId = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.event.amount = amount;
    return this;
  }

  withAttemptNumber(attemptNumber: number): this {
    this.event.attemptNumber = attemptNumber;
    return this;
  }

  build(): PaymentEvent {
    return { ...this.event };
  }

  toApiPayload(): Record<string, string | number> {
    return {
      event_id: this.event.eventId,
      type: this.event.type,
      subscription_id: this.event.subscriptionId,
      invoice_id: this.event.invoiceId,
      amount: this.event.amount,
      currency: this.event.currency,
      ...(this.event.attemptNumber === undefined
        ? {}
        : { attempt_number: this.event.attemptNumber }),
    };
  }
}
