import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { AddressInfo } from "node:net";
import { SubscriptionService } from "../service/SubscriptionService";
import { Subscription } from "../domain/Subscription";
import { ValidationError, NotFoundError, InvalidTransitionError } from "../domain/errors";

/**
 * Deliberately plain `node:http` instead of Express: the assignment's suggested stack lists
 * Express/Supertest, but also says "prefer a stack that makes your test logic ... easy to
 * understand" and to document simplifying assumptions. Using only Node built-ins means this
 * whole repo runs with `npm install` pulling nothing but dev-only type/test tooling -- no
 * framework version drift, nothing to mock at the transport layer. The route table below is
 * intentionally tiny (4 routes) so the tradeoff costs us almost nothing. See DESIGN.md.
 */

function toSubscriptionDTO(sub: Subscription) {
  return {
    id: sub.id,
    customer_id: sub.customerId,
    plan: sub.plan.name,
    status: sub.status,
    payment_method_id: sub.paymentMethodId,
    trial_ends_at: sub.trialEndsAt.toISOString(),
    created_at: sub.createdAt.toISOString(),
    retry_count: sub.retryCount,
  };
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

export function createApp(service: SubscriptionService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://internal");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "POST" && path === "/subscriptions") {
        const raw = await readRawBody(req);
        const parsed = raw.length ? JSON.parse(raw) : {};
        const sub = await service.create({
          customerId: parsed.customer_id,
          plan: parsed.plan,
          paymentMethodId: parsed.payment_method_id,
        });
        return sendJson(res, 201, toSubscriptionDTO(sub));
      }

      const getMatch = method === "GET" && path.match(/^\/subscriptions\/([^/]+)$/);
      if (getMatch) {
        const sub = service.get(decodeURIComponent(getMatch[1]));
        return sendJson(res, 200, toSubscriptionDTO(sub));
      }

      const cancelMatch = method === "POST" && path.match(/^\/subscriptions\/([^/]+)\/cancel$/);
      if (cancelMatch) {
        const sub = await service.cancel(decodeURIComponent(cancelMatch[1]));
        return sendJson(res, 200, toSubscriptionDTO(sub));
      }

      if (method === "POST" && path === "/webhooks/payment-provider") {
        const raw = await readRawBody(req);
        const signatureHeader = req.headers["x-provider-signature"];
        const result = service.handleWebhook(raw, Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader);
        return sendJson(res, result.httpStatus, result.body);
      }

      return sendJson(res, 404, { error: `no route for ${method} ${path}` });
    } catch (err) {
      if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
      if (err instanceof NotFoundError) return sendJson(res, 404, { error: err.message });
      if (err instanceof InvalidTransitionError) return sendJson(res, 409, { error: err.message });
      if (err instanceof SyntaxError) return sendJson(res, 400, { error: "malformed JSON body" });
      // eslint-disable-next-line no-console
      console.error("Unhandled error in test fixture API:", err);
      return sendJson(res, 500, { error: "internal error" });
    }
  });
}

export function listenEphemeral(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}
