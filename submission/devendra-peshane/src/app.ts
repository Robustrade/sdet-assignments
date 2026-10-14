import express, { type Request, type Response } from "express";
import { SubscriptionService } from "./services/SubscriptionService";
import { BillingRepository } from "./repositories/BillingRepository";
import { WebhookService } from "./services/WebhookService";

type RequestWithRawBody = Request & { rawBody?: Buffer };

export function createApp(
  service = new SubscriptionService(),
  billingRepository = new BillingRepository(),
  webhookSecret = process.env.WEBHOOK_SECRET ?? "test-webhook-secret"
) {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as RequestWithRawBody).rawBody = Buffer.from(buffer);
      },
    })
  );

  const webhookService = new WebhookService(
    billingRepository,
    webhookSecret
  );

  app.post("/subscriptions", (req: Request, res: Response) => {
    try {
      const subscription = service.create(
        req.body?.customerId,
        req.body?.plan
      );
      return res.status(201).json({ data: subscription });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return res.status(400).json({ error: message });
    }
  });

  app.get("/subscriptions/:id", (req: Request, res: Response) => {
    const id = req.params.id;

    if (typeof id !== "string") {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    const subscription = service.getById(id);

    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    return res.status(200).json({ data: subscription });
  });

  app.post("/subscriptions/:id/cancel", (req: Request, res: Response) => {
    const id = req.params.id;

    if (typeof id !== "string") {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    try {
      return res.status(200).json({ data: service.cancel(id) });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      return res.status(
        message === "Subscription not found" ? 404 : 409
      ).json({ error: message });
    }
  });

  app.post("/webhooks/payment-provider", async (req: Request, res: Response) => {
    const rawBody = (req as RequestWithRawBody).rawBody;

    if (!rawBody) {
      return res.status(400).json({ error: "Missing request body" });
    }

    const result = await webhookService.handle(
      rawBody,
      req.header("X-Provider-Signature")
    );

    return res.status(result.status).json(result.body);
  });

  return app;
}
