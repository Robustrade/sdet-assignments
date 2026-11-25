
import { InMemoryWebhookEventRepository } from "../../src/repositories/InMemoryWebhookEventRepository";

describe("Webhook event repository", () => {
  let repository: InMemoryWebhookEventRepository;

  beforeEach(() => {
    repository = new InMemoryWebhookEventRepository();
  });

  test("starts with no processed events", async () => {
    expect(await repository.count()).toBe(0);
  });
  

  test("returns false for an unknown event", async () => {
    expect(await repository.exists("evt_001"))
      .toBe(false);
  });

  test("marks an event as processed", async () => {
    await repository.markProcessed("evt_001");

    expect(await repository.exists("evt_001"))
      .toBe(true);
  });

  test("does not count duplicate events twice", async () => {
    await repository.markProcessed("evt_001");
    await repository.markProcessed("evt_001");

    expect(await repository.count()).toBe(1);
  });

  test("tracks multiple unique events", async () => {
    await repository.markProcessed("evt_001");
    await repository.markProcessed("evt_002");
    await repository.markProcessed("evt_003");

    expect(await repository.count()).toBe(3);
  });

  test("tracks concurrent duplicate event IDs only once", async () => {
    await Promise.all([
      repository.markProcessed("evt_001"),
      repository.markProcessed("evt_001"),
      repository.markProcessed("evt_001")
    ]);

    expect(await repository.count()).toBe(1);
  });
});
