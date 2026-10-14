import { BillingRepository } from "../../src/repositories/BillingRepository";

describe("BillingRepository", () => {
  let repository: BillingRepository;

  beforeEach(() => {
    repository = new BillingRepository();
  });

  test("saves and retrieves an invoice", () => {
    repository.saveInvoice({
      id: "inv_101",
      subscriptionId: "sub_101",
      amount: 1000,
      status: "pending",
    });

    expect(repository.findInvoice("inv_101")?.status).toBe("pending");
  });

  test("saves a payment record", () => {
    repository.savePayment({
      id: "pay_101",
      invoiceId: "inv_101",
      amount: 1000,
      status: "succeeded",
      transactionId: "txn_101",
    });

    expect(repository.findPayment("pay_101")?.transactionId).toBe("txn_101");
  });

  test("tracks webhook events by unique event ID", () => {
    repository.saveEvent({
      id: "evt_101",
      type: "payment.succeeded",
      invoiceId: "inv_101",
      processed: true,
    });

    expect(repository.findEvent("evt_101")?.processed).toBe(true);
    expect(repository.findEvent("evt_missing")).toBeUndefined();
  });

  test("records audit entries", () => {
    repository.addAudit({
      action: "invoice.paid",
      entityId: "inv_101",
      timestamp: new Date().toISOString(),
    });

    expect(repository.getAuditRecords()).toHaveLength(1);
  });
});
