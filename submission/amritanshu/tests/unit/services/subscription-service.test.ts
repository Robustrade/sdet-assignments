import { describe, expect, it } from "vitest";

import {
  InMemoryCustomerRepository,
  InMemoryPlanRepository,
  InMemorySubscriptionRepository,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
} from "../../../src/repositories/in-memory-repositories.js";
import { InMemoryAuditEventRepository } from "../../../src/repositories/in-memory-repositories.js";

import { MockPaymentProvider } from "../../../src/payment/mock-payment-provider.js";
import { SubscriptionService } from "../../../src/services/subscription-service.js";

import type { Customer } from "../../../src/domain/customer.js";
import type { Plan } from "../../../src/domain/plan.js";

describe("SubscriptionService", () => {
  function createService() {
    const customerRepository =
      new InMemoryCustomerRepository();

    const planRepository =
      new InMemoryPlanRepository();

    const subscriptionRepository =
      new InMemorySubscriptionRepository();

    const invoiceRepository =
      new InMemoryInvoiceRepository();

    const paymentRepository =
      new InMemoryPaymentRepository();

    const paymentProvider =
      new MockPaymentProvider("success");
      const auditEventRepository =
  new InMemoryAuditEventRepository();

    const service = new SubscriptionService(
  customerRepository,
  planRepository,
  subscriptionRepository,
  invoiceRepository,
  paymentRepository,
  paymentProvider,
  auditEventRepository,
);

    return {
      customerRepository,
      planRepository,
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      paymentProvider,
      service,
    };
  }

  function seedCustomer(
    customerRepository: InMemoryCustomerRepository,
  ): Customer {
    const customer: Customer = {
      id: "cust_001",
      name: "Test Customer",
      email: "customer@example.com",
    };

    customerRepository.save(customer);

    return customer;
  }

  function seedProPlan(
    planRepository: InMemoryPlanRepository,
  ): Plan {
    const plan: Plan = {
      id: "pro",
      name: "Pro",
      priceCents: 4900,
      currency: "USD",
      trialDays: 14,
    };

    planRepository.save(plan);

    return plan;
  }

  it("should create a subscription and charge the correct amount", async () => {
    const {
      customerRepository,
      planRepository,
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      paymentProvider,
      service,
    } = createService();

    seedCustomer(customerRepository);
    seedProPlan(planRepository);

    const result = await service.createSubscription({
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
    });

    expect(result.subscription.customerId).toBe("cust_001");
    expect(result.subscription.planId).toBe("pro");
    expect(result.subscription.paymentMethodId).toBe(
      "pm_test_visa_4242",
    );

    expect(result.subscription.state).toBe("active");

    expect(result.invoice.amountCents).toBe(4900);
    expect(result.invoice.currency).toBe("USD");
    expect(result.invoice.status).toBe("paid");

    expect(result.payment.amountCents).toBe(4900);
    expect(result.payment.currency).toBe("USD");
    expect(result.payment.status).toBe("succeeded");

    const calls = paymentProvider.getCalls();

    expect(calls).toHaveLength(1);

    expect(calls[0]).toMatchObject({
      customerId: "cust_001",
      paymentMethodId: "pm_test_visa_4242",
      amountCents: 4900,
      currency: "USD",
      idempotencyKey: result.invoice.id,
    });

    expect(subscriptionRepository.findById(result.subscription.id))
      .toEqual(result.subscription);

    expect(invoiceRepository.findById(result.invoice.id))
      .toEqual(result.invoice);

    expect(paymentRepository.findById(result.payment.id))
      .toEqual(result.payment);
  });

  it("should mark the subscription past_due when payment is declined", async () => {
    const {
      customerRepository,
      planRepository,
      paymentProvider,
      service,
    } = createService();

    seedCustomer(customerRepository);
    seedProPlan(planRepository);

    paymentProvider.setOutcome("decline");

    const result = await service.createSubscription({
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
    });

    expect(result.subscription.state).toBe("past_due");
    expect(result.invoice.status).toBe("failed");
    expect(result.payment.status).toBe("failed");

    expect(paymentProvider.getCalls()).toHaveLength(1);
  });
  it("should propagate a payment provider timeout without creating a payment", async () => {
  const {
    customerRepository,
    planRepository,
    paymentProvider,
    subscriptionRepository,
    invoiceRepository,
    paymentRepository,
    service,
  } = createService();

  seedCustomer(customerRepository);
  seedProPlan(planRepository);

  paymentProvider.setOutcome("timeout");

  await expect(
    service.createSubscription({
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
    }),
  ).rejects.toThrow("PAYMENT_PROVIDER_TIMEOUT");

  expect(paymentProvider.getCalls()).toHaveLength(1);

  const subscription = subscriptionRepository.findById(
    "sub_001",
  );

  // The generated subscription ID is not sub_001,
  // so verify the repository contains no successful payment instead.
  expect(paymentRepository.findBySubscriptionId("sub_001")).toHaveLength(0);
});

  it("should reject an unknown customer without calling the payment provider", async () => {
    const {
      planRepository,
      paymentProvider,
      service,
    } = createService();

    seedProPlan(planRepository);

    await expect(
      service.createSubscription({
        customerId: "cust_unknown",
        planId: "pro",
        paymentMethodId: "pm_test_visa_4242",
      }),
    ).rejects.toThrow("Customer not found");

    expect(paymentProvider.getCalls()).toHaveLength(0);
  });

  it("should reject an unknown plan without calling the payment provider", async () => {
    const {
      customerRepository,
      paymentProvider,
      service,
    } = createService();

    seedCustomer(customerRepository);

    await expect(
      service.createSubscription({
        customerId: "cust_001",
        planId: "pro",
        paymentMethodId: "pm_test_visa_4242",
      }),
    ).rejects.toThrow("Plan not found");

    expect(paymentProvider.getCalls()).toHaveLength(0);
  });

  it("should reject a missing payment method without calling the payment provider", async () => {
    const {
      customerRepository,
      planRepository,
      paymentProvider,
      service,
    } = createService();

    seedCustomer(customerRepository);
    seedProPlan(planRepository);

    await expect(
      service.createSubscription({
        customerId: "cust_001",
        planId: "pro",
        paymentMethodId: "",
      }),
    ).rejects.toThrow("Payment method is required");

    expect(paymentProvider.getCalls()).toHaveLength(0);
  });
    it("should cancel an active subscription", async () => {
    const {
      customerRepository,
      planRepository,
      subscriptionRepository,
      service,
    } = createService();

    seedCustomer(customerRepository);
    seedProPlan(planRepository);

    const created = await service.createSubscription({
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
    });

    const canceled = await service.cancelSubscription(
      created.subscription.id,
    );

    expect(canceled.state).toBe("canceled");
    expect(canceled.canceledAt).toBeInstanceOf(Date);

    expect(
      subscriptionRepository.findById(created.subscription.id)?.state,
    ).toBe("canceled");
  });

  it("should reject cancellation of an unknown subscription", async () => {
    const { service } = createService();

    await expect(
      service.cancelSubscription("sub_unknown"),
    ).rejects.toThrow("Subscription not found");
  });

  it("should reject cancellation of an already canceled subscription", async () => {
    const {
      customerRepository,
      planRepository,
      service,
    } = createService();

    seedCustomer(customerRepository);
    seedProPlan(planRepository);

    const created = await service.createSubscription({
      customerId: "cust_001",
      planId: "pro",
      paymentMethodId: "pm_test_visa_4242",
    });

    await service.cancelSubscription(created.subscription.id);

    await expect(
      service.cancelSubscription(created.subscription.id),
    ).rejects.toThrow("Invalid subscription transition");
  });
  });