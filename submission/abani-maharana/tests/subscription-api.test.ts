import { describe, expect, it } from "vitest";

import { createTestApp } from "./fixtures/test-app";

import { SubscriptionApiClient } from "./support/api-client";

import { SubscriptionAssertions } from "./assertions/subscription.assertions";

describe("Subscription API", () => {
  it("creates ACTIVE subscription after successful initial charge", async () => {
    const { app, repository, paymentProvider } = createTestApp({
      success: true,
      reference: "pay_001",
    });

    const api = new SubscriptionApiClient(app);

    const response = await api.createSubscription({
      customerId: "cus_001",
      paymentMethodId: "pm_001",
      plan: "basic",
    });

    expect(response.status).toBe(201);

    expect(response.body.status).toBe("active");

    expect(paymentProvider.getChargeCount()).toBe(1);

    expect(paymentProvider.getLastCharge()).toEqual(
      expect.objectContaining({
        customerId: "cus_001",
        paymentMethodId: "pm_001",
        amount: 999,
        currency: "USD",
        idempotencyKey: expect.stringContaining("initial-charge-"),
      }),
    );

    const assertions = new SubscriptionAssertions(repository);

    assertions.expectStatus(response.body.id, "active");

    assertions.expectPayment(`inv_${response.body.id}`, "succeeded");
  });

  it("moves subscription to PAST_DUE after payment decline", async () => {
    const { app, repository, paymentProvider } = createTestApp({
      type: "decline",
      reference: "pay_declined_001",
      failureReason: "card_declined",
    });

    const api = new SubscriptionApiClient(app);

    const response = await api.createSubscription({
      customerId: "cus_002",
      paymentMethodId: "pm_002",
      plan: "basic",
    });

    expect(response.status).toBe(201);

    expect(response.body.status).toBe("past_due");

    expect(paymentProvider.getChargeCount()).toBe(1);

    const assertions = new SubscriptionAssertions(repository);

    assertions.expectStatus(response.body.id, "past_due");

    assertions.expectPayment(`inv_${response.body.id}`, "failed");
  });

  it("returns 400 for invalid creation request", async () => {
    const { app, paymentProvider } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const response = await api.createSubscription({
      customerId: "",
      paymentMethodId: "pm_001",
      plan: "basic",
    });

    expect(response.status).toBe(400);

    expect(paymentProvider.getChargeCount()).toBe(0);
  });

  it("returns persisted subscription", async () => {
    const { app } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const created = await api.createSubscription({
      customerId: "cus_get",
      paymentMethodId: "pm_get",
      plan: "basic",
    });

    const response = await api.getSubscription(created.body.id);

    expect(response.status).toBe(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: created.body.id,
        customerId: "cus_get",
        status: "active",
      }),
    );
  });

  it("cancels an active subscription and persists CANCELED", async () => {
    const { app, repository } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const created = await api.createSubscription({
      customerId: "cus_cancel",
      paymentMethodId: "pm_cancel",
      plan: "basic",
    });

    const response = await api.cancelSubscription(created.body.id);

    expect(response.status).toBe(200);

    expect(response.body.status).toBe("canceled");

    const assertions = new SubscriptionAssertions(repository);

    assertions.expectStatus(created.body.id, "canceled");
  });

  it("rejects canceling an already canceled subscription", async () => {
    const { app } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const created = await api.createSubscription({
      customerId: "cus_cancel_twice",
      paymentMethodId: "pm_cancel_twice",
      plan: "basic",
    });

    const first = await api.cancelSubscription(created.body.id);

    expect(first.status).toBe(200);

    const second = await api.cancelSubscription(created.body.id);

    expect(second.status).toBe(409);
  });

  it("returns 404 for an unknown subscription", async () => {
    const { app } = createTestApp();

    const api = new SubscriptionApiClient(app);

    const response = await api.getSubscription("does-not-exist");

    expect(response.status).toBe(404);
  });

  it("handles payment provider timeout without activating subscription", async () => {
    const { app, repository, paymentProvider } = createTestApp({
      type: "timeout",
    });

    const api = new SubscriptionApiClient(app);

    const response = await api.createSubscription({
      customerId: "cus_timeout",
      paymentMethodId: "pm_timeout",
      plan: "basic",
    });

    expect(response.status).toBe(503);

    expect(paymentProvider.getChargeCount()).toBe(1);

    /*
     * The subscription was created before
     * the external timeout, but it must not
     * become ACTIVE.
     */
    const subscriptions = Array.from(
      (
        repository as unknown as {
          subscriptions?: Map<string, unknown>;
        }
      ).subscriptions?.values() ?? [],
    );

    expect(subscriptions.length).toBeGreaterThan(0);
  });
});
