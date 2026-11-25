import { createApp } from "../../src/app";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";

describe("Plan Change API", () => {
    let client: SubscriptionApiClient;
    let provider: MockPaymentProvider;
    let invoices: InMemoryInvoiceRepository;
    let subscriptions: InMemorySubscriptionRepository;

    beforeEach(() => {
        provider = new MockPaymentProvider("success");
        invoices = new InMemoryInvoiceRepository();
        subscriptions = new InMemorySubscriptionRepository();

        client = new SubscriptionApiClient(
            createApp(
                "test_secret",
                provider,
                invoices,
                subscriptions
            )
        );
    });

    test("upgrades basic subscription to pro", async () => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_basic"
        });

        expect(created.status).toBe(201);

        const response = await client.changePlan(
            created.body.id,
            { planId: "plan_pro" }
        );

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(created.body.id);
        expect(response.body.planId).toBe("plan_pro");
        expect(response.body.status).toBe(created.body.status);

        const saved = await subscriptions.findById(
            created.body.id
        );

        expect(saved?.planId).toBe("plan_pro");
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
    });
    test("rejects plan change for unknown subscription", async () => {
        const response = await client.changePlan(
            "unknown_subscription",
            { planId: "plan_pro" }
        );

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Subscription not found");

        expect(await subscriptions.findAll()).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
        expect(provider.calls).toHaveLength(0);
    });
    test("rejects plan change for canceled subscription", async () => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_basic"
        });

        expect(created.status).toBe(201);

        const canceled = await client.cancelSubscription(
            created.body.id
        );

        expect(canceled.status).toBe(200);

        const response = await client.changePlan(
            created.body.id,
            { planId: "plan_pro" }
        );

        expect(response.status).toBe(409);

        expect(response.body.error).toBe(
            "Canceled subscription cannot change plan"
        );

        const saved = await subscriptions.findById(
            created.body.id
        );

        expect(saved?.planId).toBe("plan_basic");
        expect(saved?.status).toBe("canceled");
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
    });
    test("treats changing to the same plan as a no-op", async () => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_basic"
        });

        expect(created.status).toBe(201);

        const before = await subscriptions.findById(
            created.body.id
        );

        const response = await client.changePlan(
            created.body.id,
            { planId: "plan_basic" }
        );

        expect(response.status).toBe(200);
        expect(response.body.planId).toBe("plan_basic");

        const after = await subscriptions.findById(
            created.body.id
        );

        expect(after).toEqual(before);
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
    });
    test("downgrades pro subscription to basic", async () => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_pro",
            paymentMethodId: "pm_test_visa_4242"
        });

        expect(created.status).toBe(201);
        expect(created.body.status).toBe("active");
        expect(provider.calls).toHaveLength(1);
        expect(await invoices.findAll()).toHaveLength(1);

        const response = await client.changePlan(
            created.body.id,
            { planId: "plan_basic" }
        );

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(created.body.id);
        expect(response.body.planId).toBe("plan_basic");
        expect(response.body.status).toBe("active");

        const saved = await subscriptions.findById(
            created.body.id
        );

        expect(saved?.planId).toBe("plan_basic");
        expect(saved?.status).toBe("active");
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(1);
        expect(await invoices.findAll()).toHaveLength(1);
    });
    test.each([
        "invalid_plan",
        "plan_premium",
        "constructor"
    ])("rejects invalid target plan: %s", async (planId) => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_basic"
        });

        expect(created.status).toBe(201);

        const response = await client.changePlan(
            created.body.id,
            { planId }
        );

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Invalid plan");

        const saved = await subscriptions.findById(
            created.body.id
        );

        expect(saved?.planId).toBe("plan_basic");
        expect(saved?.status).toBe("trialing");
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
    });
    test.each([
        {},
        { planId: "" },
        { planId: "   " }
    ])("rejects missing or empty target plan: %j", async (data) => {
        const created = await client.createSubscription({
            customerId: "cust_001",
            planId: "plan_basic"
        });

        expect(created.status).toBe(201);

        const response = await client.changePlan(
            created.body.id,
            data
        );

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Plan ID is required");

        const saved = await subscriptions.findById(
            created.body.id
        );

        expect(saved?.planId).toBe("plan_basic");
        expect(saved?.status).toBe("trialing");
        expect(await subscriptions.findAll()).toHaveLength(1);
        expect(provider.calls).toHaveLength(0);
        expect(await invoices.findAll()).toHaveLength(0);
    });
test("charges the pro price after upgrading from basic", async () => {
  const created = await client.createSubscription({
    customerId: "cust_001",
    planId: "plan_basic"
  });

  expect(created.status).toBe(201);

  const upgraded = await client.changePlan(
    created.body.id,
    { planId: "plan_pro" }
  );

  expect(upgraded.status).toBe(200);
  expect(upgraded.body.planId).toBe("plan_pro");
  expect(provider.calls).toHaveLength(0);

  const billed = await client.billSubscription(
    created.body.id,
    {
      paymentMethodId: "pm_test_visa_4242",
      idempotencyKey: "upgrade_billing_001"
    }
  );

  expect(billed.status).toBe(200);

  expect(provider.calls).toHaveLength(1);

  expect(provider.calls[0]).toMatchObject({
    amount: 4900,
    currency: "USD"
  });

  const savedInvoices = await invoices.findAll();

  expect(savedInvoices).toHaveLength(1);

  expect(savedInvoices[0]).toMatchObject({
    subscriptionId: created.body.id,
    amount: 4900,
    currency: "USD",
    status: "paid"
  });

  const saved = await subscriptions.findById(
    created.body.id
  );

  expect(saved?.planId).toBe("plan_pro");
  expect(saved?.status).toBe("active");
});
test("charges the basic price after downgrading from pro", async () => {
  const created = await client.createSubscription({
    customerId: "cust_001",
    planId: "plan_pro",
    paymentMethodId: "pm_test_visa_4242"
  });

  expect(created.status).toBe(201);
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0].amount).toBe(4900);

  const downgraded = await client.changePlan(
    created.body.id,
    { planId: "plan_basic" }
  );

  expect(downgraded.status).toBe(200);
  expect(downgraded.body.planId).toBe("plan_basic");
  expect(provider.calls).toHaveLength(1);

  const billed = await client.billSubscription(
    created.body.id,
    {
      paymentMethodId: "pm_test_visa_4242",
      idempotencyKey: "downgrade_billing_001"
    }
  );

  expect(billed.status).toBe(200);
  expect(provider.calls).toHaveLength(2);

  expect(provider.calls[1]).toMatchObject({
    amount: 1900,
    currency: "USD"
  });

  const savedInvoices = await invoices.findAll();

  expect(savedInvoices).toHaveLength(2);

  expect(savedInvoices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        subscriptionId: created.body.id,
        amount: 4900,
        status: "paid"
      }),
      expect.objectContaining({
        subscriptionId: created.body.id,
        amount: 1900,
        status: "paid"
      })
    ])
  );

  const saved = await subscriptions.findById(
    created.body.id
  );

  expect(saved?.planId).toBe("plan_basic");
  expect(saved?.status).toBe("active");
});
});