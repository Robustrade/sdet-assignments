import { MockPaymentProvider } from "../../src/services/PaymentProvider";

describe("MockPaymentProvider", () => {
  test("returns success for a successful payment", async () => {
    const provider = new MockPaymentProvider("success");

    const result = await provider.charge(
      "cus_101",
      1000,
      "invoice_101"
    );

    expect(result).toEqual({
      status: "success",
      transactionId: "txn_invoice_101",
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual({
      customerId: "cus_101",
      amount: 1000,
      idempotencyKey: "invoice_101",
    });
  });

  test("returns declined when payment fails", async () => {
    const provider = new MockPaymentProvider("declined");

    const result = await provider.charge(
      "cus_101",
      1000,
      "invoice_102"
    );

    expect(result.status).toBe("declined");
  });

  test("returns timeout when provider times out", async () => {
    const provider = new MockPaymentProvider("timeout");

    const result = await provider.charge(
      "cus_101",
      1000,
      "invoice_103"
    );

    expect(result.status).toBe("timeout");
  });

  test("can switch payment outcomes", async () => {
    const provider = new MockPaymentProvider("declined");

    expect(
      (await provider.charge("cus_101", 1000, "invoice_104")).status
    ).toBe("declined");

    provider.setOutcome("success");

    expect(
      (await provider.charge("cus_101", 1000, "invoice_105")).status
    ).toBe("success");
  });
});
