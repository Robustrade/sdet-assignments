import { createApp } from "../src/api/app";
import { SubscriptionApiClient } from "./api/SubscriptionApiClient";

export class TestFixture {
  readonly server: ReturnType<typeof createApp>;
  readonly api: SubscriptionApiClient;

  constructor() {
    process.env.NODE_ENV = "test";

    this.server = createApp();
    this.api = new SubscriptionApiClient(this.server);
  }
}