import { WebhookAuditRecord } from "../../src/domain/WebhookEvent";
import { InMemoryWebhookEventRepository } from "../../src/repositories/InMemoryWebhookEventRepository";

describe("Webhook Audit Repository", () => {
  let repository: InMemoryWebhookEventRepository;
  let record: WebhookAuditRecord;

  beforeEach(() => {
    repository = new InMemoryWebhookEventRepository();

    record = {
      eventId: "evt_001",
      eventType: "payment.succeeded",
      subscriptionId: "sub_001",
      invoiceId: "inv_001",
      outcome: "processed",
      processedAt: new Date("2026-01-01T10:00:00Z")
    };
  });

  test("returns empty audit history initially", async () => {
    expect(
      await repository.findAuditHistory()
    ).toEqual([]);
  });

  test("stores complete audit record", async () => {
    await repository.saveAudit(record);

    const history = await repository.findAuditHistory();

    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(record);
    expect(history[0].processedAt).toBeInstanceOf(Date);
  });

  test("preserves duplicate deliveries in insertion order", async () => {
    await repository.saveAudit(record);

    await repository.saveAudit({
      ...record,
      outcome: "duplicate"
    });

    await repository.saveAudit({
      ...record,
      outcome: "duplicate"
    });

    const history = await repository.findAuditHistory();

    expect(history).toHaveLength(3);

    expect(history.map(item => item.outcome)).toEqual([
      "processed",
      "duplicate",
      "duplicate"
    ]);
  });

  test("protects stored records from input mutation", async () => {
    await repository.saveAudit(record);

    record.eventId = "modified_event";
    record.outcome = "ignored";
    record.processedAt.setUTCFullYear(2030);

    const history = await repository.findAuditHistory();

    expect(history[0].eventId).toBe("evt_001");
    expect(history[0].outcome).toBe("processed");

    expect(history[0].processedAt.toISOString()).toBe(
      "2026-01-01T10:00:00.000Z"
    );
  });

  test("protects stored records from returned data mutation", async () => {
    await repository.saveAudit(record);

    const history = await repository.findAuditHistory();

    history[0].eventId = "modified_event";
    history[0].outcome = "ignored";
    history[0].processedAt.setUTCFullYear(2030);

    const freshHistory =
      await repository.findAuditHistory();

    expect(freshHistory[0]).toEqual(record);
  });

  test("protects stored history from array mutation", async () => {
    await repository.saveAudit(record);

    const history = await repository.findAuditHistory();

    history.length = 0;

    expect(
      await repository.findAuditHistory()
    ).toHaveLength(1);
  });

  test("keeps audit history separate from processed event tracking", async () => {
    await repository.saveAudit(record);

    expect(await repository.count()).toBe(0);
    expect(await repository.exists("evt_001")).toBe(false);

    await repository.markProcessed("evt_001");

    expect(await repository.count()).toBe(1);
    expect(await repository.exists("evt_001")).toBe(true);

    expect(
      await repository.findAuditHistory()
    ).toHaveLength(1);
  });
});