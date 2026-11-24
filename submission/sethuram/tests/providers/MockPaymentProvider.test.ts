
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { ChargeRequest } from "../../src/providers/PaymentProvider";

describe("Mock payment provider", () => {
  const request: ChargeRequest = {
    customerId: "cust_001",
    paymentMethodId: "pm_test_visa_4242",
    amount: 4900,
    currency: "USD",
    idempotencyKey: "charge_001"
  };

  test("returns successful payment", async () => {
    const provider = new MockPaymentProvider("success");

    const result = await provider.charge(request);

    expect(result.status).toBe("succeeded");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual(request);
  });

  test("returns declined payment", async () => {
    const provider = new MockPaymentProvider("decline");

    const result = await provider.charge(request);

    expect(result.status).toBe("declined");
    expect(provider.calls).toHaveLength(1);
  });

  test("handles payment provider timeout", async () => {
    const provider = new MockPaymentProvider("timeout");

    await expect(provider.charge(request))
      .rejects.toThrow("Payment provider timeout");

    expect(provider.calls).toHaveLength(1);
  });
});
