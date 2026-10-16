import type { Subscription } from "../domain/Subscription"; import type { Customer } from "../domain/Customer"; import { getPlan } from "../domain/Plan"; import { SubscriptionStateMachine } from "../domain/SubscriptionStateMachine"; import type { PaymentProvider } from "../payments/PaymentProvider"; import { InMemoryBillingRepository } from "../persistence/InMemoryBillingRepository"; import type { Invoice } from "../persistence/Invoice"; import type { AuditEvent } from "../persistence/AuditEvent";

export class SubscriptionService { constructor( private readonly repository: InMemoryBillingRepository, private readonly paymentProvider: PaymentProvider, private readonly stateMachine = new SubscriptionStateMachine(), ) {}

async createSubscription(input: { customerId: string; planName: string; paymentMethodId: string; }): Promise<Subscription> { const customer: Customer | undefined = this.repository.getCustomer( input.customerId, );

if (!customer) {
  throw new Error("Unknown customer");
}

if (!input.paymentMethodId.trim()) {
  throw new Error("Payment method is required");
}

const plan = getPlan(input.planName);

if (!plan) {
  throw new Error("Unknown plan");
}

const now = new Date();
const createdAt = now.toISOString();

const subscription: Subscription = {
  id: `sub_${crypto.randomUUID()}`,
  customerId: customer.id,
  plan: plan.name,
  paymentMethodId: input.paymentMethodId,
  status: plan.chargeImmediately ? "past_due" : "trialing",
  createdAt,
  trialEndsAt:
    plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 86_400_000).toISOString()
      : null,
  canceledAt: null,
};

this.repository.saveSubscription(subscription);

this.repository.saveAuditEvent({
  id: `audit_${crypto.randomUUID()}`,
  subscriptionId: subscription.id,
  fromStatus: null,
  toStatus: subscription.status,
  reason: "subscription_created",
  occurredAt: createdAt,
});

if (!plan.chargeImmediately) {
  return subscription;
}

const invoiceId = `inv_${crypto.randomUUID()}`;
const idempotencyKey = `${subscription.id}-initial-charge`;

const invoice: Invoice = {
  id: invoiceId,
  subscriptionId: subscription.id,
  customerId: customer.id,
  amountInCents: plan.priceInCents,
  currency: plan.currency,
  status: "pending",
  providerReference: null,
  idempotencyKey,
  createdAt,
  updatedAt: createdAt,
};

this.repository.saveInvoice(invoice);

let result;

try {
  result = await this.paymentProvider.charge({
    customerId: customer.id,
    paymentMethodId: input.paymentMethodId,
    amountInCents: plan.priceInCents,
    currency: plan.currency,
    idempotencyKey,
  });
} catch {
  invoice.status = "failed";
  invoice.updatedAt = new Date().toISOString();
  this.repository.saveInvoice(invoice);

  return subscription;
}

invoice.status = result.outcome === "succeeded" ? "succeeded" : "failed";
invoice.providerReference = result.providerReference;
invoice.updatedAt = new Date().toISOString();
this.repository.saveInvoice(invoice);

if (result.outcome === "succeeded") {
  subscription.status = this.stateMachine.transition(
    "past_due",
    "payment_succeeded",
  );
}

this.repository.saveSubscription(subscription);

this.repository.saveAuditEvent({
  id: `audit_${crypto.randomUUID()}`,
  subscriptionId: subscription.id,
  fromStatus: "past_due",
  toStatus: subscription.status,
  reason:
    result.outcome === "succeeded"
      ? "initial_payment_succeeded"
      : "initial_payment_failed",
  occurredAt: invoice.updatedAt,
});

return subscription;


}

cancelSubscription(subscriptionId: string): Subscription {
  const subscription = this.repository.getSubscription(subscriptionId);

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  const now = new Date().toISOString();

  const nextStatus = this.stateMachine.transition(
    subscription.status,
    "customer_canceled",
  );

  const updatedSubscription: Subscription = {
    ...subscription,
    status: nextStatus,
    canceledAt: now,
  };

  this.repository.saveSubscription(updatedSubscription);

  this.repository.saveAuditEvent({
    id: `audit_${crypto.randomUUID()}`,
    subscriptionId,
    fromStatus: subscription.status,
    toStatus: nextStatus,
    reason: "customer_canceled",
    occurredAt: now,
  });

  return updatedSubscription;
}
}