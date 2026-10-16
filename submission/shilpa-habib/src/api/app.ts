import express, { type Request, type Response } from "express"; import type { InMemoryBillingRepository } from "../persistence/InMemoryBillingRepository"; import type { SubscriptionService } from "../services/SubscriptionService";
import {
  PaymentWebhookError,
  PaymentWebhookService,
} from "../services/PaymentWebhookService";

export function createApp( service: SubscriptionService, repository: InMemoryBillingRepository,

  webhookSecret = "test_webhook_secret",
) {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody =
          Buffer.from(buffer);
      },
    }),
  );

  const webhookService = new PaymentWebhookService(
    repository,
    webhookSecret,
  );

app.use(express.json());

app.post("/subscriptions", async (req: Request, res: Response) => { const { customer_id, plan, payment_method_id } = req.body ?? {};

if (
  typeof customer_id !== "string" ||
  typeof plan !== "string" ||
  typeof payment_method_id !== "string"
) {
  return res.status(400).json({
    error: "customer_id, plan, and payment_method_id are required",
  });
}

try {
  const subscription = await service.createSubscription({
    customerId: customer_id,
    planName: plan,
    paymentMethodId: payment_method_id,
  });

  return res.status(201).json(subscription);
} catch (error: unknown) {
  const message =
    error instanceof Error ? error.message : "Internal server error";

  if (message === "Unknown customer") {
    return res.status(404).json({ error: message });
  }

  if (
    message === "Unknown plan" ||
    message === "Payment method is required"
  ) {
    return res.status(400).json({ error: message });
  }

  return res.status(500).json({ error: "Internal server error" });
}


});

app.get("/subscriptions/:id", (req: Request<{ id: string }>, res: Response) => { const subscription = repository.getSubscription(req.params.id);

if (!subscription) {
  return res.status(404).json({ error: "Subscription not found" });
}

return res.status(200).json(subscription);


});

app.post(
  "/subscriptions/:id/cancel",
  (req: Request<{ id: string }>, res: Response) => {
    try {
      const subscription = service.cancelSubscription(req.params.id);
      return res.status(200).json(subscription);
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === "Subscription not found") {
          return res.status(404).json({ error: error.message });
        }

        if (error.name === "InvalidSubscriptionTransitionError") {
          return res.status(409).json({ error: error.message });
        }
      }

      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.post(
  "/webhooks/payment-provider",
  (req: Request, res: Response) => {
    try {
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

      if (!rawBody) {
        return res.status(400).json({
          error: "Missing request body",
        });
      }

      const result = webhookService.process(
        rawBody,
        req.header("X-Provider-Signature"),
      );

      return res.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof PaymentWebhookError) {
        return res.status(error.statusCode).json({
          error: error.message,
        });
      }

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  },
);

return app; }