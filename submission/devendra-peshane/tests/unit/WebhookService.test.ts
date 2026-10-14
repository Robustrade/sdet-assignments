import { BillingRepository } from "../../src/repositories/BillingRepository";
import { WebhookService } from "../../src/services/WebhookService";

describe("WebhookService", () => {
  const secret = "test-webhook-secret";
  let repository: BillingRepository;
  let service: WebhookService;

  const sendEvent = async (
    id: string,
    type: "payment.succeeded" | "payment.failed" | "payment.refunded"
  ) => {
    const payload = JSON.stringify({
      id,
      type,
      data: {
        invoiceId: "inv_101",
        transactionId: "txn_101",
        amount: 1000,
      },
    });

    const signature = WebhookService.sign(payload, secret);

    return service.handle(Buffer.from(payload), signature);
  };

  beforeEach(() => {
    repository = new BillingRepository();
    repository.saveInvoice({
      id: "inv_101",
      subscriptionId: "sub_101",
      amount: 1000,
      status: "pending",
    });
    service = new WebhookService(repository, secret);
  });

  test("rejects an invalid signature", async () => {
    const payload = Buffer.from('{"id":"evt_1"}');

    const result = await service.handle(payload, "invalid");

    expect(result.status).toBe(401);
  });

  test("rejects malformed JSON even with a valid signature", async () => {
    const payload = "{invalid json";
    const signature = WebhookService.sign(payload, secret);

    const result = await service.handle(Buffer.from(payload), signature);

    expect(result.status).toBe(400);
  });

  test("marks an invoice paid on payment success", async () => {
    const result = await sendEvent("evt_success", "payment.succeeded");

    expect(result.status).toBe(200);
    expect(repository.findInvoice("inv_101")?.status).toBe("paid");
    expect(repository.findPayment("pay_inv_101")?.status).toBe("succeeded");
  });

  test("does not process the same event twice", async () => {
    await sendEvent("evt_success", "payment.succeeded");
    const duplicate = await sendEvent("evt_success", "payment.succeeded");

    expect(duplicate.body.duplicate).toBe(true);
    expect(repository.getAuditRecords()).toHaveLength(1);
  });

  test("a late failure does not regress a paid invoice", async () => {
    await sendEvent("evt_success", "payment.succeeded");
    await sendEvent("evt_late_failure", "payment.failed");

    expect(repository.findInvoice("inv_101")?.status).toBe("paid");
    expect(repository.findPayment("pay_inv_101")?.status).toBe("succeeded");
  });

  test("marks a pending invoice failed", async () => {
    await sendEvent("evt_failure", "payment.failed");

    expect(repository.findInvoice("inv_101")?.status).toBe("failed");
    expect(repository.findPayment("pay_inv_101")?.status).toBe("failed");
  });

  test("marks a paid invoice refunded", async () => {
    await sendEvent("evt_success", "payment.succeeded");
    await sendEvent("evt_refund", "payment.refunded");

    expect(repository.findInvoice("inv_101")?.status).toBe("refunded");
    expect(repository.findPayment("pay_inv_101")?.status).toBe("refunded");
  });
});
