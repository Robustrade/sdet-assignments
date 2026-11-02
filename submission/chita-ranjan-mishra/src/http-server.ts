import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { BillingError, BillingService } from "./billing-service.js";
import type { PaymentEvent } from "./domain.js";

const maximumBodyBytes = 1_048_576;

export interface HttpServerOptions {
  service: BillingService;
  webhookSecret: string;
}

export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function createBillingHttpServer(options: HttpServerOptions): Server {
  return createServer((request, response) => {
    void routeRequest(request, response, options);
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";

    if (method === "POST" && url.pathname === "/subscriptions") {
      const payload = await readJsonBody(request);
      const subscription = await options.service.createSubscription({
        customerId: readString(payload, "customer_id"),
        planId: readString(payload, "plan"),
        paymentMethodId: readString(payload, "payment_method_id"),
      });
      sendJson(response, 201, { subscription });
      return;
    }

    const subscriptionMatch = /^\/subscriptions\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && subscriptionMatch) {
      const subscriptionId = decodeURIComponent(subscriptionMatch[1] ?? "");
      sendJson(response, 200, {
        subscription: options.service.getSubscription(subscriptionId),
      });
      return;
    }

    const cancelMatch = /^\/subscriptions\/([^/]+)\/cancel$/.exec(url.pathname);
    if (method === "POST" && cancelMatch) {
      const subscriptionId = decodeURIComponent(cancelMatch[1] ?? "");
      await readRawBody(request);
      sendJson(response, 200, {
        subscription: options.service.cancelSubscription(subscriptionId),
      });
      return;
    }

    const planMatch = /^\/subscriptions\/([^/]+)\/plan$/.exec(url.pathname);
    if (method === "POST" && planMatch) {
      const subscriptionId = decodeURIComponent(planMatch[1] ?? "");
      const payload = await readJsonBody(request);
      sendJson(response, 200, {
        subscription: options.service.changeSubscriptionPlan(
          subscriptionId,
          readString(payload, "plan"),
        ),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/webhooks/payment-provider") {
      const rawBody = await readRawBody(request);
      const signature = request.headers["x-provider-signature"];
      if (
        typeof signature !== "string" ||
        !isValidSignature(rawBody, signature, options.webhookSecret)
      ) {
        throw new BillingError(401, "Invalid provider signature");
      }

      const payload = parseJson(rawBody);
      const event = parsePaymentEvent(payload);
      const result = await options.service.processWebhook(event);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof BillingError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "Malformed JSON body" });
      return;
    }
    if (error instanceof URIError) {
      sendJson(response, 400, { error: "Malformed URL parameter" });
      return;
    }

    console.error("Unexpected billing HTTP error", error);
    sendJson(response, 500, { error: "Internal server error" });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const rawBody = await readRawBody(request);
  const parsed = parseJson(rawBody);
  if (!isRecord(parsed)) {
    throw new BillingError(400, "JSON body must be an object");
  }
  return parsed;
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maximumBodyBytes) {
      throw new BillingError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(rawBody: string): unknown {
  if (!rawBody) {
    throw new BillingError(400, "Request body is required");
  }
  return JSON.parse(rawBody) as unknown;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BillingError(400, `${key} must be a non-empty string`);
  }
  return value;
}

function parsePaymentEvent(payload: unknown): PaymentEvent {
  if (!isRecord(payload)) {
    throw new BillingError(400, "Webhook payload must be a JSON object");
  }

  const type = payload.type;
  if (
    type !== "payment.succeeded" &&
    type !== "payment.failed" &&
    type !== "payment.refunded"
  ) {
    throw new BillingError(400, "Unsupported webhook event type");
  }

  const event: PaymentEvent = {
    eventId: readString(payload, "event_id"),
    type,
    subscriptionId: readString(payload, "subscription_id"),
    invoiceId: readString(payload, "invoice_id"),
    amount: readNumber(payload, "amount"),
    currency: readString(payload, "currency"),
  };
  if (
    !Number.isInteger(event.amount) ||
    event.amount < 0 ||
    !/^[A-Z]{3}$/.test(event.currency)
  ) {
    throw new BillingError(400, "Webhook amount or currency is invalid");
  }

  if (payload.attempt_number !== undefined) {
    const attemptNumber = payload.attempt_number;
    if (
      typeof attemptNumber !== "number" ||
      !Number.isInteger(attemptNumber) ||
      attemptNumber < 1
    ) {
      throw new BillingError(400, "attempt_number must be a positive integer");
    }
    event.attemptNumber = attemptNumber;
  }
  return event;
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BillingError(400, `${key} must be a number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSignature(body: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signWebhookBody(body, secret));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
