
import { Invoice } from "../../src/domain/Invoice";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";

describe("Invoice repository persistence", () => {
  let repository: InMemoryInvoiceRepository;

  const invoice: Invoice = {
    id: "inv_001",
    subscriptionId: "sub_001",
    customerId: "cust_001",
    amount: 4900,
    currency: "USD",
    status: "pending",
    idempotencyKey: "billing_001",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };

  beforeEach(() => {
    repository = new InMemoryInvoiceRepository();
  });

  test("saves and retrieves an invoice", async () => {
    await repository.save(invoice);

    const result = await repository.findById(invoice.id);

    expect(result).toEqual(invoice);
  });

  test("returns null for an unknown invoice", async () => {
    const result = await repository.findById("invalid_id");

    expect(result).toBeNull();
  });

  test("updates invoice payment status", async () => {
    await repository.save(invoice);

    await repository.save({
      ...invoice,
      status: "paid",
      transactionId: "txn_success"
    });

    const result = await repository.findById(invoice.id);

    expect(result?.status).toBe("paid");
    expect(result?.transactionId).toBe("txn_success");
  });

  test("retrieves invoices by subscription ID", async () => {
    await repository.save(invoice);

    const result = await repository.findBySubscriptionId(
      "sub_001"
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(invoice);
  });

  test("retrieves invoice by idempotency key", async () => {
    await repository.save(invoice);

    const result = await repository.findByIdempotencyKey(
      "billing_001"
    );

    expect(result).toEqual(invoice);
  });

  test("rejects duplicate billing attempts", async () => {
    await repository.save(invoice);

    await expect(
      repository.save({
        ...invoice,
        id: "inv_002"
      })
    ).rejects.toThrow("Duplicate billing attempt");

    expect(await repository.findAll()).toHaveLength(1);
  });
});
