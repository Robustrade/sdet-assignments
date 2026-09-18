import { Server } from "node:http";
import { InMemoryDatabase } from "../../src/persistence/InMemoryDatabase";
import { SubscriptionRepository } from "../../src/persistence/SubscriptionRepository";
import { InvoiceRepository } from "../../src/persistence/InvoiceRepository";
import { WebhookEventRepository } from "../../src/persistence/WebhookEventRepository";
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { WebhookSignature } from "../../src/security/webhookSignature";
import { SubscriptionService } from "../../src/service/SubscriptionService";
import { createApp, listenEphemeral } from "../../src/api/server";
import { ApiClient } from "./ApiClient";

export const WEBHOOK_SECRET = "test_webhook_shared_secret";

/**
 * One TestFixture per test = full isolation: a fresh InMemoryDatabase means nothing persisted
 * by one test can leak into or produce a false positive/negative in another (no shared globals,
 * no truncate step to forget). It also owns the one seam every test needs to control: the mock
 * payment provider, injected into SubscriptionService via its constructor (dependency
 * injection around the PaymentProvider interface -- see src/providers/PaymentProvider.ts).
 *
 * Usage:
 *   const fixture = await TestFixture.start();
 *   try { ... } finally { await fixture.stop(); }
 */
export class TestFixture {
  private constructor(
    public readonly db: InMemoryDatabase,
    public readonly subscriptions: SubscriptionRepository,
    public readonly invoices: InvoiceRepository,
    public readonly webhookEvents: WebhookEventRepository,
    public readonly paymentProvider: MockPaymentProvider,
    public readonly signature: WebhookSignature,
    public readonly service: SubscriptionService,
    private readonly server: Server,
    public readonly api: ApiClient
  ) {}

  static async start(): Promise<TestFixture> {
    const db = new InMemoryDatabase();
    const subscriptions = new SubscriptionRepository(db);
    const invoices = new InvoiceRepository(db);
    const webhookEvents = new WebhookEventRepository(db);
    const paymentProvider = new MockPaymentProvider();
    const signature = new WebhookSignature(WEBHOOK_SECRET);
    const service = new SubscriptionService(subscriptions, invoices, webhookEvents, paymentProvider, signature);
    const server = createApp(service);
    const baseUrl = await listenEphemeral(server);
    const api = new ApiClient(baseUrl, signature);

    return new TestFixture(db, subscriptions, invoices, webhookEvents, paymentProvider, signature, service, server, api);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
