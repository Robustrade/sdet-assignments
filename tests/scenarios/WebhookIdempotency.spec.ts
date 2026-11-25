import {
  describe,
  test,
  expect
} from "vitest";

import {
  InMemoryWebhookEventRepository
} from "../../src/repositories/InMemoryWebhookEventRepository";

import {
  WebhookProcessor
} from "../../src/webhook/WebhookProcessor";

describe(
  "Webhook Idempotency",
  () => {

    test(
      "processes event only once",
      () => {

        const repository =
          new InMemoryWebhookEventRepository();

        const processor =
          new WebhookProcessor(
            repository
          );

        const first =
          processor.process(
            "evt_001"
          );

        const second =
          processor.process(
            "evt_001"
          );

        expect(first)
          .toBe(true);

        expect(second)
          .toBe(false);

      }
    );

  }
);