
import { BillingService } from "../../src/services/BillingService";
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { PlanCatalog } from "../../src/domain/Plan";

describe("Billing service integration", () => {
  let billingService: BillingService;
  let subscriptionService: SubscriptionService;
  let subscriptionRepository: InMemorySubscriptionRepository;
  let invoiceRepository: InMemoryInvoiceRepository;
  let paymentProvider: MockPaymentProvider;
  let planCatalog: PlanCatalog;
  let subscriptionId: string;

  beforeEach(async () => {
    invoiceRepository = new InMemoryInvoiceRepository();
    paymentProvider = new MockPaymentProvider("success");
    planCatalog = new PlanCatalog();

    subscriptionRepository =
  new InMemorySubscriptionRepository();

subscriptionService = new SubscriptionService(
  subscriptionRepository,
  new SubscriptionStateMachine(),
  planCatalog,
  undefined,
  invoiceRepository
);

    billingService = new BillingService(
      subscriptionService,
      invoiceRepository,
      paymentProvider,
      planCatalog
    );

    const subscription =
      await subscriptionService.createSubscription(
        "cust_001",
        "plan_basic"
      );

    subscriptionId = subscription.id;
  });

  test("creates a paid invoice for successful payment", async () => {
    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_001"
    );

    expect(invoice.status).toBe("paid");
    expect(invoice.transactionId).toBe("txn_success");
  });

  test("activates subscription after successful payment", async () => {
    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_002"
    );

    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("active");
  });

  test("creates a failed invoice for declined payment", async () => {
    paymentProvider.setOutcome("decline");

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_003"
    );

    expect(invoice.status).toBe("failed");
    expect(invoice.transactionId).toBe("txn_declined");
  });

  test("moves subscription to past_due after decline", async () => {
    paymentProvider.setOutcome("decline");

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_004"
    );

    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("past_due");
  });

  test("handles payment provider timeout", async () => {
    paymentProvider.setOutcome("timeout");

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_005"
    );

    expect(invoice.status).toBe("timeout");

    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("trialing");
  });

  test("prevents duplicate payment for the same key", async () => {
    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_006"
    );

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_006"
    );

    expect(second.id).toBe(first.id);
    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);
  });

  test("rejects billing for a canceled subscription", async () => {
    await subscriptionService.changeStatus(
      subscriptionId,
      "canceled"
    );

    await expect(
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "billing_007"
      )
    ).rejects.toThrow("Cannot bill a canceled subscription");

    expect(paymentProvider.calls).toHaveLength(0);
  });

  test("rejects an unknown subscription", async () => {
    await expect(
      billingService.billSubscription(
        "invalid_subscription",
        "pm_test_001",
        "billing_008"
      )
    ).rejects.toThrow("Subscription not found");

    expect(paymentProvider.calls).toHaveLength(0);
  });

  test("charges the correct plan amount and currency", async () => {
    const plan = planCatalog.getPlan("plan_basic");

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "billing_009"
    );

    expect(paymentProvider.calls[0]).toMatchObject({
      customerId: "cust_001",
      paymentMethodId: "pm_test_001",
      amount: plan.amount,
      currency: plan.currency,
      idempotencyKey: "billing_009"
    });
  });

  test("rejects an empty idempotency key", async () => {
    await expect(
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        ""
      )
    ).rejects.toThrow(
      "Payment method and idempotency key are required"
    );

    expect(paymentProvider.calls).toHaveLength(0);
  });

  test("recovers from declined payment using a new billing key", async () => {
    paymentProvider.setOutcome("decline");

    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "retry_001"
    );

    expect(first.status).toBe("failed");

    paymentProvider.setOutcome("success");

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "retry_002"
    );

    expect(second.status).toBe("paid");

    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("active");
    expect(paymentProvider.calls).toHaveLength(2);
  });

  test("does not charge again when a declined request is repeated", async () => {
    paymentProvider.setOutcome("decline");

    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_decline"
    );

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_decline"
    );

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("failed");
    expect(paymentProvider.calls).toHaveLength(1);
  });

  test("does not automatically recharge after a timeout with the same key", async () => {
    paymentProvider.setOutcome("timeout");

    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "timeout_001"
    );

    paymentProvider.setOutcome("success");

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "timeout_001"
    );

    expect(second.id).toBe(first.id);
    expect(second.status).toBe("timeout");
    expect(paymentProvider.calls).toHaveLength(1);
  });

  test("rejects the same billing key for a different subscription", async () => {
    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "shared_key"
    );

    const anotherSubscription =
      await subscriptionService.createSubscription(
        "cust_002",
        "plan_basic"
      );

    await expect(
      billingService.billSubscription(
        anotherSubscription.id,
        "pm_test_002",
        "shared_key"
      )
    ).rejects.toThrow("Idempotency key conflict");

    expect(paymentProvider.calls).toHaveLength(1);
  });

  test("rejects an empty payment method", async () => {
    await expect(
      billingService.billSubscription(
        subscriptionId,
        "",
        "invalid_payment"
      )
    ).rejects.toThrow(
      "Payment method and idempotency key are required"
    );

    expect(paymentProvider.calls).toHaveLength(0);
    expect(await invoiceRepository.findAll()).toHaveLength(0);
  });

  test("persists the final paid invoice", async () => {
    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "persistence_001"
    );

    const savedInvoice =
      await invoiceRepository.findById(invoice.id);

    expect(savedInvoice).toEqual(invoice);
    expect(savedInvoice?.status).toBe("paid");
    expect(savedInvoice?.transactionId).toBe("txn_success");
  });

  test("prevents duplicate charges for concurrent requests", async () => {
    const results = await Promise.all([
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "concurrent_001"
      ),
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "concurrent_001"
      )
    ]);

    expect(results[0].id).toBe(results[1].id);
    expect(results[0].status).toBe("paid");
    expect(results[1].status).toBe("paid");
    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);
  });

  test("handles five simultaneous duplicate billing requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        billingService.billSubscription(
          subscriptionId,
          "pm_test_001",
          "concurrent_002"
        )
      )
    );

    const invoiceIds = new Set(
      results.map(invoice => invoice.id)
    );

    expect(invoiceIds.size).toBe(1);
    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);

    results.forEach(invoice => {
      expect(invoice.status).toBe("paid");
    });
  });

  test("rejects concurrent billing key conflict across subscriptions", async () => {
    const anotherSubscription =
      await subscriptionService.createSubscription(
        "cust_002",
        "plan_basic"
      );

    const first = billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "concurrent_conflict"
    );

    const second = billingService.billSubscription(
      anotherSubscription.id,
      "pm_test_002",
      "concurrent_conflict"
    );

    await Promise.all([
      expect(first).resolves.toMatchObject({
        status: "paid"
      }),
      expect(second).rejects.toThrow(
        "Idempotency key conflict"
      )
    ]);

    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);
  });

  test("rejects billing for an invalid plan without charging", async () => {
  const subscription =
    await subscriptionService.createSubscription(
      "cust_invalid",
      "plan_basic"
    );

  await subscriptionRepository.save({
    ...subscription,
    planId: "invalid_plan"
  });

  await expect(
    billingService.billSubscription(
      subscription.id,
      "pm_test_001",
      "invalid_plan_001"
    )
  ).rejects.toThrow("Invalid plan");

  expect(paymentProvider.calls).toHaveLength(0);
  expect(await invoiceRepository.findAll()).toHaveLength(0);
});

  test("charges the correct amount for the pro plan", async () => {
    const subscription =
      await subscriptionService.createSubscription(
        "cust_pro",
        "plan_pro"
      );

    const invoice = await billingService.billSubscription(
      subscription.id,
      "pm_test_001",
      "pro_billing_001"
    );

    expect(invoice.amount).toBe(4900);
    expect(invoice.currency).toBe("USD");
    expect(invoice.status).toBe("paid");

    expect(paymentProvider.calls).toHaveLength(1);

    expect(paymentProvider.calls[0]).toMatchObject({
      customerId: "cust_pro",
      amount: 4900,
      currency: "USD",
      idempotencyKey: "pro_billing_001"
    });
  });

  test("successful recurring billing preserves active subscription", async () => {
    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "recurring_001"
    );

    expect(first.status).toBe("paid");

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "recurring_002"
    );

    expect(second.status).toBe("paid");
    expect(second.id).not.toBe(first.id);

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("active");

    const invoices = await invoiceRepository.findAll();

    expect(invoices).toHaveLength(2);

    expect(
      invoices.every(invoice => invoice.status === "paid")
    ).toBe(true);

    expect(paymentProvider.calls).toHaveLength(2);
  });

  test("failed recurring billing moves active subscription to past_due", async () => {
    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "recurring_success"
    );

    expect(first.status).toBe("paid");

    const activeSubscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(activeSubscription?.status).toBe("active");

    paymentProvider.setOutcome("decline");

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "recurring_failure"
    );

    expect(second.status).toBe("failed");

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("past_due");

    const invoices = await invoiceRepository.findAll();

    expect(invoices).toHaveLength(2);

    expect(
      invoices.filter(invoice => invoice.status === "paid")
    ).toHaveLength(1);

    expect(
      invoices.filter(invoice => invoice.status === "failed")
    ).toHaveLength(1);

    expect(paymentProvider.calls).toHaveLength(2);
  });

  test("resets failed payment attempts after successful payment", async () => {
    paymentProvider.setOutcome("decline");

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "reset_failure_001"
    );

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "reset_failure_002"
    );

    const failed =
      await subscriptionRepository.findById(subscriptionId);

    expect(failed?.status).toBe("past_due");
    expect(failed?.failedPaymentAttempts).toBe(2);

    paymentProvider.setOutcome("success");

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "reset_success"
    );

    expect(invoice.status).toBe("paid");

    const recovered =
      await subscriptionRepository.findById(subscriptionId);

    expect(recovered?.status).toBe("active");
    expect(recovered?.failedPaymentAttempts).toBe(0);

    paymentProvider.setOutcome("decline");

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "reset_failure_003"
    );

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("past_due");
    expect(subscription?.failedPaymentAttempts).toBe(1);
    expect(paymentProvider.calls).toHaveLength(4);
  });

  test("duplicate declined payments do not consume additional retries", async () => {
    paymentProvider.setOutcome("decline");

    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    const third = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    expect(first.status).toBe("failed");
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("past_due");
    expect(subscription?.failedPaymentAttempts).toBe(1);

    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);
  });

  test("duplicate declined payments do not consume additional retries", async () => {
    paymentProvider.setOutcome("decline");

    const first = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    const second = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    const third = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "duplicate_retry_001"
    );

    expect(first.status).toBe("failed");
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("past_due");
    expect(subscription?.failedPaymentAttempts).toBe(1);

    expect(paymentProvider.calls).toHaveLength(1);
    expect(await invoiceRepository.findAll()).toHaveLength(1);
  });

  test("payment timeout does not increase failed payment attempts", async () => {
    paymentProvider.setOutcome("decline");

    await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "timeout_failure_001"
    );

    paymentProvider.setOutcome("timeout");

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "timeout_retry_001"
    );

    expect(invoice.status).toBe("timeout");

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.status).toBe("past_due");
    expect(subscription?.failedPaymentAttempts).toBe(1);

    expect(paymentProvider.calls).toHaveLength(2);
    expect(await invoiceRepository.findAll()).toHaveLength(2);
  });

  test("tracks concurrent declined payments without losing retry counts", async () => {
    paymentProvider.setOutcome("decline");

    const invoices = await Promise.all([
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "concurrent_retry_001"
      ),
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "concurrent_retry_002"
      ),
      billingService.billSubscription(
        subscriptionId,
        "pm_test_001",
        "concurrent_retry_003"
      )
    ]);

    expect(invoices).toHaveLength(3);

    expect(
      invoices.every(invoice => invoice.status === "failed")
    ).toBe(true);

    const subscription =
      await subscriptionRepository.findById(subscriptionId);

    expect(subscription?.failedPaymentAttempts).toBe(3);
    expect(subscription?.status).toBe("canceled");

    expect(paymentProvider.calls).toHaveLength(3);

    expect(
      await invoiceRepository.findAll()
    ).toHaveLength(3);
  });
test("activates subscription after successful trial expiry billing", async () => {
  jest.useFakeTimers();

  try {
    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("trialing");
    expect(subscription?.trialEndsAt).toBeDefined();
    expect(paymentProvider.calls).toHaveLength(0);

    jest.setSystemTime(
      subscription!.trialEndsAt!
    );

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "trial_expiry_success"
    );

    expect(invoice.status).toBe("paid");
    expect(invoice.amount).toBe(1900);
    expect(invoice.currency).toBe("USD");

    const stored =
      await subscriptionRepository.findById(subscriptionId);

    expect(stored?.status).toBe("active");
    expect(paymentProvider.calls).toHaveLength(1);

    const savedInvoice =
      await invoiceRepository.findById(invoice.id);

    expect(savedInvoice?.status).toBe("paid");

  } finally {
    jest.useRealTimers();
  }
});
test("moves subscription to past_due after failed trial expiry billing", async () => {
  jest.useFakeTimers();

  try {
    const subscription =
      await subscriptionService.getSubscription(subscriptionId);

    expect(subscription?.status).toBe("trialing");
    expect(subscription?.trialEndsAt).toBeDefined();
    expect(paymentProvider.calls).toHaveLength(0);

    jest.setSystemTime(
      subscription!.trialEndsAt!
    );

    paymentProvider.setOutcome("decline");

    const invoice = await billingService.billSubscription(
      subscriptionId,
      "pm_test_001",
      "trial_expiry_failure"
    );

    expect(invoice.status).toBe("failed");
    expect(invoice.amount).toBe(1900);
    expect(invoice.currency).toBe("USD");

    const stored =
      await subscriptionRepository.findById(subscriptionId);

    expect(stored?.status).toBe("past_due");
    expect(stored?.failedPaymentAttempts).toBe(1);
    expect(paymentProvider.calls).toHaveLength(1);

    const savedInvoice =
      await invoiceRepository.findById(invoice.id);

    expect(savedInvoice?.status).toBe("failed");

  } finally {
    jest.useRealTimers();
  }
});
});
