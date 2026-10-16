import { describe, expect, it } from "vitest"; import { InMemoryBillingRepository } from "../../src/persistence/InMemoryBillingRepository"; import type { Subscription } from "../../src/domain/Subscription"; import type { Invoice } from "../../src/persistence/Invoice"; import type { WebhookEvent } from "../../src/persistence/WebhookEvent"; import type { AuditEvent } from "../../src/persistence/AuditEvent";

describe("InMemoryBillingRepository", () => { it("stores and retrieves a subscription without exposing its internal object", () => { const repository = new InMemoryBillingRepository();

const subscription: Subscription = {
  id: "sub_001",
  customerId: "cust_001",
  plan: "pro",
  paymentMethodId: "pm_test_visa_4242",
  status: "trialing",
  createdAt: "2026-10-16T10:00:00.000Z",
  trialEndsAt: "2026-10-30T10:00:00.000Z",
  canceledAt: null,
};

repository.saveSubscription(subscription);

const retrieved = repository.getSubscription("sub_001");

expect(retrieved).toEqual(subscription);
expect(retrieved).not.toBe(subscription);

retrieved!.status = "canceled";

expect(repository.getSubscription("sub_001")?.status).toBe("trialing");


});

it("stores invoices and filters them by subscription", () => { const repository = new InMemoryBillingRepository();

const invoice: Invoice = {
  id: "inv_001",
  subscriptionId: "sub_001",
  customerId: "cust_001",
  amountInCents: 4900,
  currency: "USD",
  status: "succeeded",
  providerReference: "pay_1",
  idempotencyKey: "sub_001-initial-charge",
  createdAt: "2026-10-16T10:00:00.000Z",
  updatedAt: "2026-10-16T10:00:00.000Z",
};

repository.saveInvoice(invoice);

expect(repository.getInvoice("inv_001")).toEqual(invoice);
expect(repository.getInvoicesForSubscription("sub_001")).toEqual([invoice]);
expect(repository.getInvoicesForSubscription("sub_002")).toEqual([]);


});

it("stores webhook events using event IDs", () => { const repository = new InMemoryBillingRepository();

const event: WebhookEvent = {
  eventId: "evt_001",
  type: "payment.succeeded",
  subscriptionId: "sub_001",
  invoiceId: "inv_001",
  receivedAt: "2026-10-16T10:00:00.000Z",
  processed: true,
  duplicate: false,
  ignoredReason: null,
};

repository.saveWebhookEvent(event);

expect(repository.getWebhookEvent("evt_001")).toEqual(event);
expect(repository.getAllWebhookEvents()).toHaveLength(1);


});

it("stores and retrieves subscription audit history", () => { const repository = new InMemoryBillingRepository();

const event: AuditEvent = {
  id: "audit_001",
  subscriptionId: "sub_001",
  fromStatus: "trialing",
  toStatus: "active",
  reason: "payment_succeeded",
  occurredAt: "2026-10-16T10:00:00.000Z",
};

repository.saveAuditEvent(event);

expect(repository.getAuditEventsForSubscription("sub_001")).toEqual([event]);


});

it("clears all persisted records between tests", () => { const repository = new InMemoryBillingRepository();

const subscription: Subscription = {
  id: "sub_001",
  customerId: "cust_001",
  plan: "pro",
  paymentMethodId: "pm_test_visa_4242",
  status: "trialing",
  createdAt: "2026-10-16T10:00:00.000Z",
  trialEndsAt: "2026-10-30T10:00:00.000Z",
  canceledAt: null,
};

repository.saveSubscription(subscription);
repository.clear();

expect(repository.getAllSubscriptions()).toEqual([]);
expect(repository.getAllWebhookEvents()).toEqual([]);
expect(repository.getSubscription("sub_001")).toBeUndefined();


}); });