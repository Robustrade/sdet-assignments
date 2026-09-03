import { describe, expect, it } from "vitest";
import { TestFixture } from "./TestFixture";
import { SubscriptionStatus } from "../src/domain/SubscriptionStatus";

describe("Subscription API", () => {
  it("should create a subscription in trialing state", async () => {
    const fixture = new TestFixture();

    const response = await fixture.api.createSubscription(
      "customer_123",
      "pro"
    );

    expect(response.status).toBe(201);
    expect(response.body.customerId).toBe("customer_123");
    expect(response.body.planId).toBe("pro");
    expect(response.body.status).toBe(
      SubscriptionStatus.TRIALING
    );
    expect(response.body.id).toBeDefined();
  });

  it("should reject creating a subscription when customerId is missing", async () => {
    const fixture = new TestFixture();

    const response = await fixture.api
      .post("/subscriptions")
      .send({
        planId: "pro",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "customerId and planId are required"
    );
  });

  it("should reject creating a subscription when planId is missing", async () => {
    const fixture = new TestFixture();

    const response = await fixture.api
      .post("/subscriptions")
      .send({
        customerId: "customer_123",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "customerId and planId are required"
    );
  });

  it("should reject creating a subscription with an invalid plan", async () => {
    const fixture = new TestFixture();

    const response = await fixture.api.createSubscription(
      "customer_123",
      "invalid_plan"
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid plan");
  });

  it("should retrieve an existing subscription", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const response =
      await fixture.api.getSubscription(subscriptionId);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(subscriptionId);
    expect(response.body.status).toBe(
      SubscriptionStatus.TRIALING
    );
  });

  it("should return 404 when retrieving a non-existent subscription", async () => {
    const fixture = new TestFixture();

    const response =
      await fixture.api.getSubscription(
        "subscription_does_not_exist"
      );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Subscription not found"
    );
  });

  it("should cancel a trialing subscription", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const response =
      await fixture.api.cancelSubscription(subscriptionId);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(
      SubscriptionStatus.CANCELED
    );
    expect(response.body.canceledAt).toBeDefined();
  });

  it("should reject canceling an already canceled subscription", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    await fixture.api.cancelSubscription(subscriptionId);

    const response =
      await fixture.api.cancelSubscription(subscriptionId);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(
      "Invalid subscription transition"
    );
  });

  it("should return an error when canceling a non-existent subscription", async () => {
    const fixture = new TestFixture();

    const response =
      await fixture.api.cancelSubscription(
        "subscription_does_not_exist"
      );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(
      "Subscription not found"
    );
  });

  it("should activate a trialing subscription when payment succeeds", async () => {
    const fixture = new TestFixture();

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const paymentResponse =
      await fixture.api.pay(subscriptionId);

    expect(paymentResponse.status).toBe(200);
    expect(paymentResponse.body.status).toBe("succeeded");

    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.ACTIVE
    );

    // Verify payment provider interaction
    expect(
      fixture.server.paymentProvider.getCallCount()
    ).toBe(1);

    const providerRequest =
      fixture.server.paymentProvider.getLastRequest();

    expect(providerRequest?.subscriptionId).toBe(
      subscriptionId
    );
    expect(providerRequest?.amountInCents).toBe(4900);

    // Verify invoice was persisted correctly
    const invoices =
      fixture.server.invoiceRepository.findAll();

    const subscriptionInvoices = invoices.filter(
      (invoice) => invoice.subscriptionId === subscriptionId
    );

    expect(subscriptionInvoices).toHaveLength(1);
    expect(subscriptionInvoices[0].subscriptionId).toBe(
      subscriptionId
    );
    expect(subscriptionInvoices[0].amountInCents).toBe(4900);
    expect(subscriptionInvoices[0].status).toBe("paid");
    expect(subscriptionInvoices[0].paidAt).toBeDefined();

    // Verify audit event was persisted
    const auditEvents =
      fixture.server.auditEventRepository.findAll();

    const activationEvent = auditEvents.find(
      (event) =>
        event.subscriptionId === subscriptionId &&
        event.eventType === "payment.succeeded" &&
        event.fromStatus === SubscriptionStatus.TRIALING &&
        event.toStatus === SubscriptionStatus.ACTIVE
    );

    expect(activationEvent).toBeDefined();
  });

  it("should move a trialing subscription to past_due when payment fails", async () => {
    const fixture = new TestFixture();

    fixture.server.paymentProvider.setOutcome("decline");

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const paymentResponse =
      await fixture.api.pay(subscriptionId);

    expect(paymentResponse.status).toBe(200);
    expect(paymentResponse.body.status).toBe("failed");

    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    // Verify provider interaction
    expect(
      fixture.server.paymentProvider.getCallCount()
    ).toBe(1);

    const providerRequest =
      fixture.server.paymentProvider.getLastRequest();

    expect(providerRequest?.subscriptionId).toBe(
      subscriptionId
    );
    expect(providerRequest?.amountInCents).toBe(4900);

    // Verify failed invoice was persisted
    const invoices =
      fixture.server.invoiceRepository.findAll();

    const subscriptionInvoices = invoices.filter(
      (invoice) => invoice.subscriptionId === subscriptionId
    );

    expect(subscriptionInvoices).toHaveLength(1);
    expect(subscriptionInvoices[0].amountInCents).toBe(4900);
    expect(subscriptionInvoices[0].status).toBe("failed");
  });

  it("should move a past_due subscription back to active when retry succeeds", async () => {
    const fixture = new TestFixture();

    // First payment fails
    fixture.server.paymentProvider.setOutcome("decline");

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    const firstPaymentResponse =
      await fixture.api.pay(subscriptionId);

    expect(firstPaymentResponse.status).toBe(200);
    expect(firstPaymentResponse.body.status).toBe("failed");

    let subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    expect(subscription?.retryCount).toBe(0);

    // Retry succeeds
    fixture.server.paymentProvider.setOutcome("success");

    const retryPaymentResponse =
      await fixture.api.pay(subscriptionId);

    expect(retryPaymentResponse.status).toBe(200);
    expect(retryPaymentResponse.body.status).toBe(
      "succeeded"
    );

    subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.ACTIVE
    );

    expect(subscription?.retryCount).toBe(0);

    expect(
      fixture.server.paymentProvider.getCallCount()
    ).toBe(2);
  });

  it("should cancel a past_due subscription when retries are exhausted", async () => {
    const fixture = new TestFixture();

    // All payment attempts will fail
    fixture.server.paymentProvider.setOutcome("decline");

    const createResponse =
      await fixture.api.createSubscription(
        "customer_123",
        "pro"
      );

    const subscriptionId = createResponse.body.id;

    // Initial payment failure:
    // TRIALING -> PAST_DUE
    const firstPayment =
      await fixture.api.pay(subscriptionId);

    expect(firstPayment.status).toBe(200);
    expect(firstPayment.body.status).toBe("failed");

    let subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    expect(subscription?.retryCount).toBe(0);

    // Retry #1
    const retryOne =
      await fixture.api.pay(subscriptionId);

    expect(retryOne.status).toBe(200);

    subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    expect(subscription?.retryCount).toBe(1);

    // Retry #2
    const retryTwo =
      await fixture.api.pay(subscriptionId);

    expect(retryTwo.status).toBe(200);

    subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    expect(subscription?.retryCount).toBe(2);

    // Retry #3 - maximum retries reached
    const retryThree =
      await fixture.api.pay(subscriptionId);

    expect(retryThree.status).toBe(200);

    subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.CANCELED
    );

    expect(subscription?.retryCount).toBe(3);
    expect(subscription?.canceledAt).toBeDefined();

    // Initial payment + 3 retries = 4 provider calls
    expect(
      fixture.server.paymentProvider.getCallCount()
    ).toBe(4);
  });

  it("should handle a payment provider timeout", async () => {
    const fixture = new TestFixture();

    // Configure mock provider to timeout
    fixture.server.paymentProvider.setOutcome("timeout");

    const createResponse =
      await fixture.api.createSubscription(
        "customer_timeout",
        "pro"
      );

    expect(createResponse.status).toBe(201);

    const subscriptionId = createResponse.body.id;

    // Payment provider timeout
    const paymentResponse =
      await fixture.api.pay(subscriptionId);

    expect(paymentResponse.status).toBe(400);

    // Subscription should move to past_due
    const subscription =
      fixture.server.subscriptionRepository.findById(
        subscriptionId
      );

    expect(subscription?.status).toBe(
      SubscriptionStatus.PAST_DUE
    );

    // Failed invoice should be persisted
    const invoices =
      fixture.server.invoiceRepository.findAll();

    const subscriptionInvoices = invoices.filter(
      (invoice) => invoice.subscriptionId === subscriptionId
    );

    expect(subscriptionInvoices).toHaveLength(1);
    expect(subscriptionInvoices[0].status).toBe("failed");

    // Provider should have been called exactly once
    expect(
      fixture.server.paymentProvider.getCallCount()
    ).toBe(1);
  });
});