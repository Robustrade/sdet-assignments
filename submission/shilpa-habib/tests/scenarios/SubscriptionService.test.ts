import { beforeEach, describe, expect, it } from "vitest"; import { SubscriptionService } from "../../src/services/SubscriptionService"; import { InMemoryBillingRepository } from "../../src/persistence/InMemoryBillingRepository"; import { FakePaymentProvider } from "../../src/payments/FakePaymentProvider";

describe("SubscriptionService", () => { let repository: InMemoryBillingRepository; let provider: FakePaymentProvider; let service: SubscriptionService;

beforeEach(() => { repository = new InMemoryBillingRepository(); provider = new FakePaymentProvider(); service = new SubscriptionService(repository, provider);


repository.saveCustomer({
  id: "cust_001",
  email: "customer@example.com",
  paymentMethodId: "pm_test_visa_4242",
});
});

it("creates a pro subscription with a 14-day trial and persists it", async () => { const subscription = await service.createSubscription({ customerId: "cust_001", planName: "pro", paymentMethodId: "pm_test_visa_4242", });


expect(subscription.status).toBe("trialing");
expect(subscription.trialEndsAt).not.toBeNull();

const trialEnd = new Date(subscription.trialEndsAt!).getTime();
const created = new Date(subscription.createdAt).getTime();

expect(trialEnd - created).toBe(14 * 24 * 60 * 60 * 1000);
expect(repository.getSubscription(subscription.id)).toEqual(subscription);
expect(
  repository.getAuditEventsForSubscription(subscription.id),
).toHaveLength(1);
expect(provider.getCallCount()).toBe(0);
expect(repository.getInvoicesForSubscription(subscription.id)).toHaveLength(0);
});

it("rejects an unknown customer without creating a subscription", async () => { await expect( service.createSubscription({ customerId: "cust_unknown", planName: "pro", paymentMethodId: "pm_test_visa_4242", }), ).rejects.toThrow("Unknown customer");


expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);
});

it("rejects an unknown plan without creating a subscription", async () => { await expect( service.createSubscription({ customerId: "cust_001", planName: "enterprise", paymentMethodId: "pm_test_visa_4242", }), ).rejects.toThrow("Unknown plan");


expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);
});

it("rejects an empty payment method without creating a subscription", async () => { await expect( service.createSubscription({ customerId: "cust_001", planName: "pro", paymentMethodId: " ", }), ).rejects.toThrow("Payment method is required");


expect(repository.getAllSubscriptions()).toHaveLength(0);
expect(provider.getCallCount()).toBe(0);
});

it("activates a basic subscription after successful payment", async () => { provider.setNextOutcome("succeeded");


const subscription = await service.createSubscription({
  customerId: "cust_001",
  planName: "basic",
  paymentMethodId: "pm_test_visa_4242",
});

expect(subscription.status).toBe("active");
expect(subscription.trialEndsAt).toBeNull();

expect(repository.getSubscription(subscription.id)).toEqual(subscription);

const invoices = repository.getInvoicesForSubscription(subscription.id);
expect(invoices).toHaveLength(1);
expect(invoices[0].amountInCents).toBe(1900);
expect(invoices[0].status).toBe("succeeded");

expect(provider.getCallCount()).toBe(1);
});

it("does not activate a basic subscription when payment is declined", async () => { provider.setNextOutcome("declined");


const subscription = await service.createSubscription({
  customerId: "cust_001",
  planName: "basic",
  paymentMethodId: "pm_test_visa_4242",
});

expect(subscription.status).toBe("past_due");

const invoices = repository.getInvoicesForSubscription(subscription.id);
expect(invoices).toHaveLength(1);
expect(invoices[0].status).toBe("failed");

expect(repository.getSubscription(subscription.id)?.status).toBe("past_due");
expect(provider.getCallCount()).toBe(1);
});

it("does not activate a basic subscription when the provider times out", async () => { provider.setNextOutcome("timeout");


const subscription = await service.createSubscription({
  customerId: "cust_001",
  planName: "basic",
  paymentMethodId: "pm_test_visa_4242",
});

expect(subscription.status).toBe("past_due");

const invoices = repository.getInvoicesForSubscription(subscription.id);
expect(invoices).toHaveLength(1);
expect(invoices[0].status).toBe("failed");

expect(repository.getSubscription(subscription.id)?.status).toBe("past_due");
expect(provider.getCallCount()).toBe(1);
});
});