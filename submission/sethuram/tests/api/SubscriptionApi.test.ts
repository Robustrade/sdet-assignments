
import { createApp } from "../../src/app";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";

describe("Subscription API", () => {
  let client: SubscriptionApiClient;

  beforeEach(() => {
    client = new SubscriptionApiClient(createApp());
  });
  test("rejects an unknown customer for basic subscription", async () => {
    const provider = new MockPaymentProvider("success");
    const invoices = new InMemoryInvoiceRepository();
    const subscriptions = new InMemorySubscriptionRepository();

    const api = new SubscriptionApiClient(
      createApp("test_secret", provider, invoices, subscriptions)
    );

    const response = await api.createSubscription({
      customerId: "cust_unknown",
      planId: "plan_basic"
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unknown customer");

    expect(provider.calls).toHaveLength(0);
    expect(await invoices.findAll()).toHaveLength(0);
    expect(await subscriptions.findAll()).toHaveLength(0);
  });
    test("rejects an unknown pro customer without charging", async () => {
      const provider = new MockPaymentProvider("success");
      const invoices = new InMemoryInvoiceRepository();
      const subscriptions = new InMemorySubscriptionRepository();

      const api = new SubscriptionApiClient(
        createApp("test_secret", provider, invoices, subscriptions)
      );

      const response = await api.createSubscription({
        customerId: "cust_unknown",
        planId: "plan_pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Unknown customer");

      expect(provider.calls).toHaveLength(0);
      expect(await invoices.findAll()).toHaveLength(0);
      expect(await subscriptions.findAll()).toHaveLength(0);
    });

    test("POST creates a subscription", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_basic"
      });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.status).toBe("trialing");
    });

    test("POST rejects missing customer ID", async () => {
      const response = await client.createSubscription({
        planId: "plan_basic"
      });

      expect(response.status).toBe(400);
    });

    test("GET retrieves a created subscription", async () => {
      const created = await client.createSubscription({
        customerId: "cust_002",
        planId: "plan_basic"
      });

      expect(created.status).toBe(201);

      const response = await client.getSubscription(
        created.body.id
      );

      expect(response.status).toBe(200);
      expect(response.body.customerId).toBe("cust_002");
    });

    test("GET returns 404 for unknown subscription", async () => {
      const response = await client.getSubscription("unknown");

      expect(response.status).toBe(404);
    });
    test("POST rejects an invalid plan ID", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "invalid_plan"
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid plan");
    });

    test("POST rejects an unsupported premium plan", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_premium"
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid plan");
    });

    test("POST rejects a prototype property as plan ID", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "constructor"
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid plan");
    });
    test("immediately bills a pro subscription without a trial", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(response.status).toBe(201);
      expect(response.body.planId).toBe("plan_pro");
      expect(response.body.status).toBe("active");

      const retrieved = await client.getSubscription(
        response.body.id
      );

      expect(retrieved.status).toBe(200);
      expect(retrieved.body.status).toBe("active");
    });
    test("rejects pro subscription without payment method", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro"
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Payment method is required"
      );
    });
    test("rejects pro subscription with empty payment method", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro",
        paymentMethodId: ""
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Payment method is required"
      );
    });
    test("rejects pro subscription with whitespace payment method", async () => {
      const response = await client.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro",
        paymentMethodId: "   "
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Payment method is required"
      );
    });
    test("persists a paid invoice for immediate pro billing", async () => {
      const provider = new MockPaymentProvider("success");
      const invoices = new InMemoryInvoiceRepository();

      const api = new SubscriptionApiClient(
        createApp("test_secret", provider, invoices)
      );

      const response = await api.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("active");

      expect(provider.calls).toHaveLength(1);

      expect(provider.calls[0]).toMatchObject({
        customerId: "cust_001",
        paymentMethodId: "pm_test_visa_4242",
        amount: 4900,
        currency: "USD"
      });

      const savedInvoices = await invoices.findAll();

      expect(savedInvoices).toHaveLength(1);

      expect(savedInvoices[0]).toMatchObject({
        subscriptionId: response.body.id,
        amount: 4900,
        currency: "USD",
        status: "paid"
      });
    });
    test("does not activate pro subscription when payment is declined", async () => {
      const provider = new MockPaymentProvider("decline");
      const invoices = new InMemoryInvoiceRepository();

      const api = new SubscriptionApiClient(
        createApp("test_secret", provider, invoices)
      );

      const response = await api.createSubscription({
        customerId: "cust_001",
        planId: "plan_pro",
        paymentMethodId: "pm_test_visa_4242"
      });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe("past_due");

      expect(provider.calls).toHaveLength(1);

      const savedInvoices = await invoices.findAll();

      expect(savedInvoices).toHaveLength(1);

      expect(savedInvoices[0]).toMatchObject({
        subscriptionId: response.body.id,
        amount: 4900,
        currency: "USD",
        status: "failed"
      });

      const retrieved = await api.getSubscription(
        response.body.id
      );

      expect(retrieved.status).toBe(200);
      expect(retrieved.body.status).toBe("past_due");
    });
  test("does not activate pro subscription when payment times out", async () => {
    const provider = new MockPaymentProvider("timeout");
    const invoices = new InMemoryInvoiceRepository();

    const api = new SubscriptionApiClient(
      createApp("test_secret", provider, invoices)
    );

    const response = await api.createSubscription({
      customerId: "cust_001",
      planId: "plan_pro",
      paymentMethodId: "pm_test_visa_4242"
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("trialing");

    expect(provider.calls).toHaveLength(1);

    const savedInvoices = await invoices.findAll();

    expect(savedInvoices).toHaveLength(1);

    expect(savedInvoices[0]).toMatchObject({
      subscriptionId: response.body.id,
      amount: 4900,
      currency: "USD",
      status: "timeout"
    });

    const retrieved = await api.getSubscription(
      response.body.id
    );

    expect(retrieved.status).toBe(200);
    expect(retrieved.body.status).toBe("trialing");
  });
test("creates a basic trial without charging the customer", async () => {
  const provider = new MockPaymentProvider("success");
  const invoices = new InMemoryInvoiceRepository();
  const subscriptions = new InMemorySubscriptionRepository();

  const api = new SubscriptionApiClient(
    createApp(
      "test_secret",
      provider,
      invoices,
      subscriptions
    )
  );

  const response = await api.createSubscription({
    customerId: "cust_001",
    planId: "plan_basic",
    paymentMethodId: "pm_test_visa_4242"
  });

  expect(response.status).toBe(201);
  expect(response.body.status).toBe("trialing");
  expect(response.body.planId).toBe("plan_basic");

  expect(provider.calls).toHaveLength(0);
  expect(await invoices.findAll()).toHaveLength(0);

  const saved = await subscriptions.findById(
    response.body.id
  );

  expect(saved).toMatchObject({
    customerId: "cust_001",
    planId: "plan_basic",
    status: "trialing",
    failedPaymentAttempts: 0
  });
});
});