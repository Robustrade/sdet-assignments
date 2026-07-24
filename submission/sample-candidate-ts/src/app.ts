import express, { Express, Request } from "express";
import { ConsolePaymentProvider } from "./payments/ConsolePaymentProvider";
import { PaymentProvider } from "./payments/PaymentProvider";
import { Repository } from "./persistence/Repository";
import { SubscriptionService } from "./service/SubscriptionService";
import { ConflictError, NotFoundError, ValidationError } from "./service/errors";
import { HmacWebhookVerifier } from "./webhooks/WebhookVerifier";
import { WebhookEventPayload, WebhookEventType } from "./domain/types";

export interface AppHandle {
  app: Express;
  repository: Repository;
  paymentProvider: PaymentProvider;
  service: SubscriptionService;
  webhookSecret: string;
}

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

const WEBHOOK_EVENT_TYPES: WebhookEventType[] = ["payment.succeeded", "payment.failed", "payment.refunded"];

/**
 * Factory: wires the repository, a payment provider, and the service
 * together and returns both the Express app and the collaborators, so
 * tests can inject a fake PaymentProvider and assert against the
 * repository directly instead of only through HTTP responses.
 */
export function createApp(options: { paymentProvider?: PaymentProvider; webhookSecret?: string } = {}): AppHandle {
  const repository = new Repository();
  const paymentProvider = options.paymentProvider ?? new ConsolePaymentProvider();
  const webhookSecret = options.webhookSecret ?? "test-webhook-secret";
  const verifier = new HmacWebhookVerifier(webhookSecret);
  const service = new SubscriptionService(repository, paymentProvider);

  const app = express();
  app.use(
    express.json({
      verify: (req: RequestWithRawBody, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );

  app.post("/subscriptions", async (req, res) => {
    try {
      const { subscription, invoiceId } = await service.createSubscription(req.body ?? {});
      res.status(201).json({ ...subscription, invoiceId });
    } catch (err) {
      handleError(err, res);
    }
  });

  app.get("/subscriptions/:id", (req, res) => {
    try {
      const subscription = service.getSubscription(req.params.id);
      res.status(200).json(subscription);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post("/subscriptions/:id/cancel", (req, res) => {
    try {
      const subscription = service.cancelSubscription(req.params.id);
      res.status(200).json(subscription);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post("/webhooks/payment-provider", async (req: RequestWithRawBody, res) => {
    const signature = req.header("X-Provider-Signature");
    if (!signature) {
      res.status(400).json({ error: "missing X-Provider-Signature header" });
      return;
    }
    if (!verifier.verify(req.rawBody ?? "", signature)) {
      res.status(401).json({ error: "invalid webhook signature" });
      return;
    }

    const payload = req.body as Partial<WebhookEventPayload>;
    const missing = ["eventId", "type", "subscriptionId", "invoiceId", "amountCents", "currency"].filter(
      (field) => (payload as Record<string, unknown>)[field] === undefined,
    );
    if (missing.length > 0 || !WEBHOOK_EVENT_TYPES.includes(payload.type as WebhookEventType)) {
      res.status(400).json({ error: "malformed webhook payload", fields: missing });
      return;
    }

    try {
      const result = await service.handleWebhookEvent(payload as WebhookEventPayload);
      res.status(200).json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return { app, repository, paymentProvider, service, webhookSecret };
}

function handleError(err: unknown, res: express.Response): void {
  if (err instanceof ValidationError) {
    res.status(422).json({ error: err.message, fields: err.fields });
  } else if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
  } else if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
  } else {
    res.status(500).json({ error: "internal error" });
  }
}
