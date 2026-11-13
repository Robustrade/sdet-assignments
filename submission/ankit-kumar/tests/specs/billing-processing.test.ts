import { describe, expect, it } from "vitest";
import { SubscriptionService } from "../../src/application/subscription-service";
import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { InvoiceRepository } from "../../src/infrastructure/invoice-repository";
import { AuditRepository } from "../../src/infrastructure/audit-repository";
import { FakePaymentProvider } from "../support/fake-payment-provider";

describe("Billing Processing", () => {
  async function setup() {
    const database = await TestDatabase.create();
    const customers = new CustomerRepository(database);
    const subscriptions = new SubscriptionRepository(database);
    const invoices = new InvoiceRepository(database);
    const audits = new AuditRepository(database);
    const provider = new FakePaymentProvider();

    customers.save({
      id: "cust_001",
      name: "Ankit Kumar"
    });

    const service = new SubscriptionService({
      customerRepository: customers,
      subscriptionRepository: subscriptions,
      invoiceRepository: invoices,
      auditRepository: audits,
      paymentProvider: provider,
      now: () => new Date("2026-11-13T10:00:00.000Z")
    });

    return {
      database,
      subscriptions,
      invoices,
      audits,
      provider,
      service
    };
  }

  it("charges the pro plan and persists a successful invoice", async () => {
    const context = await setup();

    try {
      context.provider.queueOutcome({
        type: "success",
        providerReference: "ch_001"
      });

      const result = await context.service.createSubscription({
        customerId: "cust_001",
        plan: "pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(result.status).toBe("active");
      expect(context.provider.callCount).toBe(1);

      expect(context.provider.calls[0]).toMatchObject({
        customerId: "cust_001",
        paymentMethodId: "pm_test_visa_4242",
        amount: 4900,
        currency: "USD"
      });

      const invoices = context.invoices.findBySubscription(result.id);

      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe("succeeded");
      expect(invoices[0].providerReference).toBe("ch_001");

      expect(context.audits.findBySubscription(result.id)).toHaveLength(2);
    } finally {
      context.database.close();
    }
  });

  it("persists a failed invoice when payment is declined", async () => {
    const context = await setup();

    try {
      context.provider.queueOutcome({
        type: "declined",
        failureCode: "insufficient_funds"
      });

      const result = await context.service.createSubscription({
        customerId: "cust_001",
        plan: "pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(result.status).toBe("past_due");

      const invoices = context.invoices.findBySubscription(result.id);

      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe("failed");
      expect(invoices[0].failureCode).toBe("insufficient_funds");
    } finally {
      context.database.close();
    }
  });

  it("persists a failed invoice after provider timeout", async () => {
    const context = await setup();

    try {
      context.provider.queueOutcome({ type: "timeout" });

      const result = await context.service.createSubscription({
        customerId: "cust_001",
        plan: "pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(result.status).toBe("past_due");

      const invoices = context.invoices.findBySubscription(result.id);

      expect(invoices).toHaveLength(1);
      expect(invoices[0].status).toBe("failed");
      expect(invoices[0].failureCode).toBe("provider_timeout");
    } finally {
      context.database.close();
    }
  });
});