import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { BillingService } from "../src/billing-service.js";
import { createBillingHttpServer, signWebhookBody } from "../src/http-server.js";
import { FakePaymentProvider, type ChargeResult } from "../src/payment-provider.js";
import { InMemoryBillingRepository } from "../src/repository.js";
import { PaymentWebhookBuilder, SubscriptionRequestBuilder } from "./builders.js";

export const webhookSecret = "local-test-webhook-secret";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export type WebhookSignature = "valid" | "missing" | "invalid";

export class BillingApiClient {
  constructor(private readonly baseUrl: string) {}

  async createSubscription(
    payload: Record<string, unknown>,
  ): Promise<ApiResponse> {
    return this.request("/subscriptions", "POST", JSON.stringify(payload));
  }

  async getSubscription(subscriptionId: string): Promise<ApiResponse> {
    return this.request(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      "GET",
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<ApiResponse> {
    return this.request(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      "POST",
      "{}",
    );
  }

  async changePlan(
    subscriptionId: string,
    planId: string,
  ): Promise<ApiResponse> {
    return this.request(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/plan`,
      "POST",
      JSON.stringify({ plan: planId }),
    );
  }

  async sendWebhook(
    payload: Record<string, unknown>,
    signatureMode: WebhookSignature = "valid",
  ): Promise<ApiResponse> {
    const body = JSON.stringify(payload);
    return this.sendWebhookBody(body, signatureMode);
  }

  async sendWebhookBody(
    body: string,
    signatureMode: WebhookSignature = "valid",
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (signatureMode === "valid") {
      headers["x-provider-signature"] = signWebhookBody(body, webhookSecret);
    } else if (signatureMode === "invalid") {
      headers["x-provider-signature"] = signWebhookBody(
        body,
        "incorrect-test-secret",
      );
    }
    return this.request("/webhooks/payment-provider", "POST", body, headers);
  }

  private async request(
    path: string,
    method: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body }),
    });
    const responseBody = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body: responseBody };
  }
}

export interface BillingTestFixture {
  api: BillingApiClient;
  provider: FakePaymentProvider;
  repository: InMemoryBillingRepository;
  close(): Promise<void>;
}

export async function createFixture(
  outcomes: ChargeResult[] = [],
): Promise<BillingTestFixture> {
  const repository = new InMemoryBillingRepository();
  repository.addCustomer("cust_001");
  const provider = new FakePaymentProvider(outcomes);
  const service = new BillingService({
    repository,
    paymentProvider: provider,
    plans: [
      { id: "basic", amount: 4900, currency: "USD", trialDays: 0 },
      { id: "pro", amount: 9900, currency: "USD", trialDays: 14 },
    ],
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const server = createBillingHttpServer({ service, webhookSecret });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test HTTP server did not bind to a TCP port");
  }
  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  return {
    api: new BillingApiClient(baseUrl),
    provider,
    repository,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

export async function fixtureForTest(
  context: TestContext,
  outcomes: ChargeResult[] = [],
): Promise<BillingTestFixture> {
  const fixture = await createFixture(outcomes);
  context.after(() => fixture.close());
  return fixture;
}

export function subscriptionPayload(
  options: { planId?: string; customerId?: string; paymentMethodId?: string } = {},
): Record<string, string> {
  const builder = new SubscriptionRequestBuilder();
  if (options.planId !== undefined) {
    builder.withPlan(options.planId);
  }
  if (options.customerId !== undefined) {
    builder.withCustomer(options.customerId);
  }
  if (options.paymentMethodId !== undefined) {
    builder.withPaymentMethod(options.paymentMethodId);
  }
  return builder.toApiPayload();
}

export function webhookPayload(
  subscriptionId: string,
  options: {
    eventId?: string;
    invoiceId?: string;
    type?: "payment.succeeded" | "payment.failed" | "payment.refunded";
    amount?: number;
    attemptNumber?: number;
  } = {},
): Record<string, string | number> {
  const builder = new PaymentWebhookBuilder()
    .withSubscription(subscriptionId)
    .withInvoice(options.invoiceId ?? "inv_webhook_001")
    .withAmount(options.amount ?? 9900);
  if (options.eventId !== undefined) {
    builder.withEventId(options.eventId);
  }
  if (options.type !== undefined) {
    builder.withType(options.type);
  }
  if (options.attemptNumber !== undefined) {
    builder.withAttemptNumber(options.attemptNumber);
  }
  return builder.toApiPayload();
}
