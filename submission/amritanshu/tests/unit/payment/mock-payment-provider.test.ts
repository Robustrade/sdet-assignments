import { describe, expect, it } from "vitest";

import { MockPaymentProvider } from "../../../src/payment/mock-payment-provider.js";

describe("MockPaymentProvider", () => {
  const request = {
    customerId: "cust_001",
    paymentMethodId: "pm_test_visa_4242",
    amountCents: 4900,
    currency: "USD",
    idempotencyKey: "sub_001-initial-charge",
  };

  it("should return a successful charge", async () => {
    const provider = new MockPaymentProvider("success");

    const result = await provider.charge(request);

    expect(result.success).toBe(true);
    expect(result.providerReference).toBe(
      "ref_sub_001-initial-charge",
    );
  });

  it("should return a declined charge", async () => {
    const provider = new MockPaymentProvider("decline");

    const result = await provider.charge(request);

    expect(result.success).toBe(false);
    expect(result.failureCode).toBe("card_declined");
  });

  it("should simulate a provider timeout", async () => {
    const provider = new MockPaymentProvider("timeout");

    await expect(provider.charge(request)).rejects.toThrow(
      "PAYMENT_PROVIDER_TIMEOUT",
    );
  });

  it("should record the exact charge request", async () => {
    const provider = new MockPaymentProvider("success");

    await provider.charge(request);

    expect(provider.getCalls()).toEqual([request]);
  });
});