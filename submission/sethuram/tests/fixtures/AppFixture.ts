import { createApp } from "../../src/app";
import { MockPaymentProvider } from "../../src/providers/MockPaymentProvider";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { InMemoryWebhookEventRepository } from "../../src/repositories/InMemoryWebhookEventRepository";
import { WebhookSignature } from "../../src/services/WebhookSignature";
import { SubscriptionApiClient } from "../clients/SubscriptionApiClient";

export function createAppFixture(
  webhookSecret = "test_secret"
) {
  const provider = new MockPaymentProvider();

  const invoiceRepository =
    new InMemoryInvoiceRepository();

  const subscriptionRepository =
    new InMemorySubscriptionRepository();

  const eventRepository =
    new InMemoryWebhookEventRepository();

  const app = createApp(
    webhookSecret,
    provider,
    invoiceRepository,
    subscriptionRepository,
    eventRepository
  );

  const client = new SubscriptionApiClient(app);

  const signatureVerifier =
    new WebhookSignature(webhookSecret);

  return {
    app,
    client,
    provider,
    invoiceRepository,
    subscriptionRepository,
    eventRepository,
    signatureVerifier
  };
}