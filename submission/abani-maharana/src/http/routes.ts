import { createHmac, timingSafeEqual } from "node:crypto";

import { Router } from "express";

import { z } from "zod";

import { BillingService } from "../services/billing.service";

const createSubscriptionSchema = z.object({
  customerId: z.string().min(1),

  paymentMethodId: z.string().min(1),

  plan: z.enum(["basic", "pro"]),
});

const webhookSchema = z.object({
  event_id: z.string().min(1),

  type: z.enum(["payment.succeeded", "payment.failed", "payment.refunded"]),

  subscription_id: z.string().min(1),

  invoice_id: z.string().min(1),

  amount: z.number().positive(),

  currency: z.string().min(1),
});

interface RouteDependencies {
  billingService: BillingService;
  webhookSecret: string;
}

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createRoutes({
  billingService,
  webhookSecret,
}: RouteDependencies) {
  const router = Router();

  router.post("/subscriptions", async (req, res) => {
    const result = createSubscriptionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: result.error.flatten(),
      });
    }

    try {
      const subscription = await billingService.createSubscription(result.data);

      return res.status(201).json(subscription);
    } catch (error) {
      if (error instanceof Error && error.message === "Unknown plan") {
        return res.status(400).json({
          error: "Unknown plan",
        });
      }

      if (
        error instanceof Error &&
        error.message === "Payment provider timeout"
      ) {
        return res.status(503).json({
          error: "Payment provider unavailable",
        });
      }

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  router.get("/subscriptions/:id", (req, res) => {
    const subscription = billingService.getSubscription(req.params.id);

    if (!subscription) {
      return res.status(404).json({
        error: "Subscription not found",
      });
    }

    return res.status(200).json(subscription);
  });

  router.post("/subscriptions/:id/cancel", (req, res) => {
    try {
      const subscription = billingService.cancelSubscription(req.params.id);

      return res.status(200).json(subscription);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Subscription not found"
      ) {
        return res.status(404).json({
          error: "Subscription not found",
        });
      }

      return res.status(409).json({
        error: "Invalid subscription transition",
      });
    }
  });

  router.post("/webhooks/payment-provider", (req, res) => {
    const rawBody = (
      req as typeof req & {
        rawBody?: string;
      }
    ).rawBody;

    const signature = req.header("X-Provider-Signature");

    /*
     * Authentication must happen before payload
     * validation.
     */
    if (!rawBody || !signature) {
      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    /*
     * Verify the signature against the exact
     * raw request body.
     */
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return res.status(401).json({
        error: "Invalid webhook signature",
      });
    }

    /*
     * Signature is valid.
     *
     * Only now validate the payload.
     *
     * Therefore:
     *
     * invalid signature -> 401
     * valid signature + invalid payload -> 400
     */
    const result = webhookSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Invalid webhook payload",
        details: result.error.flatten(),
      });
    }

    try {
      const processed = billingService.processWebhook({
        eventId: result.data.event_id,
        type: result.data.type,
        subscriptionId: result.data.subscription_id,
        invoiceId: result.data.invoice_id,
        amount: result.data.amount,
        currency: result.data.currency,
      });

      return res.status(200).json({
        processed: !processed.duplicate,
        duplicate: processed.duplicate,
        subscription: processed.subscription,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Subscription not found"
      ) {
        return res.status(404).json({
          error: "Subscription not found",
        });
      }

      if (
        error instanceof Error &&
        error.message.startsWith("Invalid subscription transition")
      ) {
        return res.status(409).json({
          error: "Invalid subscription transition",
        });
      }

      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  return router;
}
