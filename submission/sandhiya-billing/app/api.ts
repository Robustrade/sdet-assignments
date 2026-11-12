import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { InvalidTransitionError } from "./domain.ts";
import {
  BillingService,
  SignatureError,
  UnknownSubscriptionError,
  ValidationError,
} from "./service.ts";

const MAX_BODY_BYTES = 1024 * 1024;

function isJsonObject(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
}

class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;

  constructor() {
    super("Request body too large");
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function errorResponse(error: unknown): number {
  if (error instanceof SignatureError) {
    return 401;
  }
  if (error instanceof UnknownSubscriptionError) {
    return 404;
  }
  if (error instanceof InvalidTransitionError) {
    return 409;
  }
  if (error instanceof ValidationError || error instanceof SyntaxError) {
    return 400;
  }
  if (error instanceof RequestBodyTooLargeError) {
    return error.statusCode;
  }
  return 500;
}

export function createApp(
  service: BillingService = new BillingService({ dbPath: "billing.db" }),
): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (request.method === "POST" && pathname === "/subscriptions") {
        const payload: unknown = JSON.parse((await readBody(request)).toString("utf8"));
        if (!isJsonObject(payload)) {
          throw new ValidationError("Request body must be a JSON object");
        }
        const created = service.createSubscription(
          payload.customer_id,
          payload.plan,
          payload.payment_method_id,
        );
        sendJson(response, 201, created);
        return;
      }

      const cancelMatch = pathname.match(/^\/subscriptions\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) {
        sendJson(response, 200, service.cancelSubscription(decodeURIComponent(cancelMatch[1]!)));
        return;
      }

      const getMatch = pathname.match(/^\/subscriptions\/([^/]+)$/);
      if (request.method === "GET" && getMatch) {
        sendJson(response, 200, service.getSubscription(decodeURIComponent(getMatch[1]!)));
        return;
      }

      if (request.method === "POST" && pathname === "/webhooks/payment-provider") {
        const rawBody = await readBody(request);
        const result = service.handleWebhook(rawBody, request.headers["x-provider-signature"]);
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { detail: "Not Found" });
    } catch (error: unknown) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const statusCode = errorResponse(error);
      sendJson(response, statusCode, {
        detail: statusCode === 500
          ? "Internal Server Error"
          : error instanceof Error ? error.message : String(error),
      });
    }
  });
}
