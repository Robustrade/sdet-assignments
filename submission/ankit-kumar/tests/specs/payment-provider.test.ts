import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "../support/fake-payment-provider";
import { PaymentProviderTimeoutError } from "../../src/domain/payment-provider";
import type { ChargeRequest } from "../../src/domain/payment-provider";

describe("Fake Payment Provider", () => {
  const request: ChargeRequest = {
    customerId: "cust_001",
    paymentMethodId: "pm_test_visa_4242",
    amount: 4900,
    currency: "USD",
    idempotencyKey: "sub_001_invoice_001"
  };

  it("simulates a successful payment", async () => {
    const provider = new FakePaymentProvider();
    provider.queueOutcome({
      type: "success",
      providerReference: "ch_success_001"
    });

    const result = await provider.charge(request);

    expect(result.outcome).toBe("succeeded");
    expect(result.providerReference).toBe("ch_success_001");
    expect(provider.callCount).toBe(1);
    expect(provider.calls[0]).toEqual(request);
  });

  it("simulates a declined payment", async () => {
    const provider = new FakePaymentProvider();
    provider.queueOutcome({
      type: "declined",
      failureCode: "insufficient_funds"
    });

    const result = await provider.charge(request);

    expect(result.outcome).toBe("declined");
    expect(result.failureCode).toBe("insufficient_funds");
    expect(provider.callCount).toBe(1);
  });

  it("simulates a provider timeout", async () => {
    const provider = new FakePaymentProvider();
    provider.queueOutcome({ type: "timeout" });

    await expect(provider.charge(request))
      .rejects.toBeInstanceOf(PaymentProviderTimeoutError);

    expect(provider.callCount).toBe(1);
  });
});