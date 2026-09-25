import { describe, expect, it } from "vitest";

import type { AuditEvent } from "../../../src/domain/audit-event.js";
import type { Invoice } from "../../../src/domain/invoice.js";
import type { Payment } from "../../../src/domain/payment.js";
import type { Subscription } from "../../../src/domain/subscription.js";
import type { WebhookEvent } from "../../../src/domain/webhook-event.js";

import {
  InMemoryAuditEventRepository,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemorySubscriptionRepository,
  InMemoryWebhookEventRepository,
} from "../../../src/repositories/in-memory-repositories.js";

describe("In-memory repositories", () => {
  it("should save and retrieve a subscription", () => {
    const repository = new InMemorySubscriptionRepository();

    const subscription: Subscription = {
      id: "sub_001",
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
      state: "trialing",
      createdAt: new Date(),
    };

    repository.save(subscription);

    expect(repository.findById("sub_001")).toEqual(subscription);
    expect(repository.findByCustomerId("cust_001")).toEqual([
      subscription,
    ]);
  });

  it("should save and retrieve an invoice", () => {
    const repository = new InMemoryInvoiceRepository();

    const invoice: Invoice = {
      id: "inv_001",
      subscriptionId: "sub_001",
      amountCents: 4900,
      currency: "USD",
      status: "pending",
      createdAt: new Date(),
    };

    repository.save(invoice);

    expect(repository.findById("inv_001")).toEqual(invoice);
    expect(repository.findBySubscriptionId("sub_001")).toEqual([
      invoice,
    ]);
  });

  it("should save and retrieve a payment", () => {
    const repository = new InMemoryPaymentRepository();

    const payment: Payment = {
      id: "pay_001",
      invoiceId: "inv_001",
      subscriptionId: "sub_001",
      amountCents: 4900,
      currency: "USD",
      status: "succeeded",
      providerReference: "provider_ref_001",
      createdAt: new Date(),
    };

    repository.save(payment);

    expect(repository.findById("pay_001")).toEqual(payment);
    expect(repository.findByInvoiceId("inv_001")).toEqual([payment]);
    expect(repository.findBySubscriptionId("sub_001")).toEqual([
      payment,
    ]);
  });

  it("should identify a webhook event by event id", () => {
    const repository = new InMemoryWebhookEventRepository();

    const event: WebhookEvent = {
      eventId: "evt_001",
      type: "payment.succeeded",
      subscriptionId: "sub_001",
      invoiceId: "inv_001",
      amountCents: 4900,
      currency: "USD",
    };

    repository.save(event);

    expect(repository.findByEventId("evt_001")).toEqual(event);
    expect(repository.findByEventId("evt_unknown")).toBeUndefined();
  });

  it("should store and retrieve audit events for a subscription", () => {
    const repository = new InMemoryAuditEventRepository();

    const event: AuditEvent = {
      id: "audit_001",
      subscriptionId: "sub_001",
      eventType: "subscription.created",
      nextState: "trialing",
      createdAt: new Date(),
    };

    repository.save(event);

    expect(repository.findBySubscriptionId("sub_001")).toEqual([
      event,
    ]);
  });
});