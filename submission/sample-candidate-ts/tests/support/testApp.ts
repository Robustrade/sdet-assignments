import { createApp } from "../../src/app";
import { Repository } from "../../src/persistence/Repository";
import { SubscriptionService } from "../../src/service/SubscriptionService";
import { FakePaymentProvider } from "./FakePaymentProvider";
import { SubscriptionApiClient } from "./SubscriptionApiClient";

const TEST_WEBHOOK_SECRET = "test-webhook-secret";

export interface TestHarness {
  api: SubscriptionApiClient;
  repository: Repository;
  paymentProvider: FakePaymentProvider;
  service: SubscriptionService;
  webhookSecret: string;
}

/** Builds a fresh app + fake payment provider + API client for one test. */
export function buildTestHarness(): TestHarness {
  const paymentProvider = new FakePaymentProvider();
  const { app, repository, service } = createApp({ paymentProvider, webhookSecret: TEST_WEBHOOK_SECRET });
  const api = new SubscriptionApiClient(app, TEST_WEBHOOK_SECRET);
  return { api, repository, paymentProvider, service, webhookSecret: TEST_WEBHOOK_SECRET };
}
