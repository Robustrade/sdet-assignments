import { describe, expect, it } from "vitest"; import { FakePaymentProvider } from "../../src/payments/FakePaymentProvider"; import type { ChargeRequest } from "../../src/payments/PaymentProvider";

describe("FakePaymentProvider", () => { const createRequest = (): ChargeRequest => ({ customerId: "cust_001", paymentMethodId: "pm_test_visa_4242", amountInCents: 4900, currency: "USD", idempotencyKey: "sub_001-initial-charge", });

it("returns success and records the exact charge request", async () => { const provider = new FakePaymentProvider(); const request = createRequest();

const result = await provider.charge(request);

expect(result.outcome).toBe("succeeded");
expect(result.providerReference).toBe("pay_1");
expect(provider.getCallCount()).toBe(1);
expect(provider.getCalls()).toEqual([request]);


});

it("can simulate a declined payment", async () => { const provider = new FakePaymentProvider(); provider.setNextOutcome("declined");

const result = await provider.charge(createRequest());

expect(result.outcome).toBe("declined");
expect(result.providerReference).toBeNull();
expect(provider.getCallCount()).toBe(1);


});

it("can simulate a provider timeout", async () => { const provider = new FakePaymentProvider(); provider.setNextOutcome("timeout");

await expect(provider.charge(createRequest())).rejects.toThrow(
  "Payment provider timed out",
);

expect(provider.getCallCount()).toBe(1);


});

it("can reset its call history and outcome", async () => { const provider = new FakePaymentProvider(); provider.setNextOutcome("declined");

await provider.charge(createRequest());
provider.reset();

expect(provider.getCallCount()).toBe(0);

const result = await provider.charge(createRequest());
expect(result.outcome).toBe("succeeded");


}); });