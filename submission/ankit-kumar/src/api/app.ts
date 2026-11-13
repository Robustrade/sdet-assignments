import express from "express";
import type { Request, Response } from "express";

import { SubscriptionService } from "../application/subscription-service";
import { WebhookService, WebhookProcessingError } from "../application/webhook-service";
import { SubscriptionRepository } from "../infrastructure/subscription-repository";

interface AppDependencies {
  subscriptionService: SubscriptionService;
  subscriptionRepository: SubscriptionRepository;
  webhookService?: WebhookService;
}

export function createApp(dependencies: AppDependencies) {
  const app = express();

  // Webhooks must receive the original raw body for HMAC verification.
  // Register this route before express.json().
  app.post(
    "/webhooks/payment-provider",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response) => {
      if (!dependencies.webhookService) {
        return res.status(501).json({
          error: "Webhook service is not configured"
        });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({
          error: "Expected a raw JSON request body"
        });
      }

      try {
        const result = dependencies.webhookService.process(
          req.body,
          req.header("X-Provider-Signature") ?? ""
        );

        return res.status(200).json({
          received: true,
          duplicate: result.duplicate,
          outcome: result.outcome
        });
      } catch (error) {
        if (error instanceof WebhookProcessingError) {
          return res.status(error.statusCode).json({
            error: error.message
          });
        }

        return res.status(500).json({
          error: "Webhook processing failed"
        });
      }
    }
  );

  app.use(express.json());

  // Create subscription
  app.post("/subscriptions", async (req: Request, res: Response) => {
    try {
      const { customer_id, plan, payment_method_id } = req.body ?? {};

      if (!customer_id || !plan || !payment_method_id) {
        return res.status(400).json({
          error: "customer_id, plan and payment_method_id are required"
        });
      }

      const subscription =
        await dependencies.subscriptionService.createSubscription({
          customerId: customer_id,
          plan,
          paymentMethodId: payment_method_id
        });

      return res.status(201).json({
        id: subscription.id,
        customer_id: subscription.customerId,
        plan: subscription.plan,
        payment_method_id: subscription.paymentMethodId,
        status: subscription.status,
        trial_ends_at: subscription.trialEndsAt,
        created_at: subscription.createdAt,
        updated_at: subscription.updatedAt
      });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error
          ? error.message
          : "Subscription creation failed"
      });
    }
  });

  // Retrieve subscription
  app.get("/subscriptions/:id", (req: Request, res: Response) => {
    const subscription =
      dependencies.subscriptionRepository.findById(
        String(req.params.id)
      );

    if (!subscription) {
      return res.status(404).json({
        error: "Subscription not found"
      });
    }

    return res.status(200).json({
      id: subscription.id,
      customer_id: subscription.customerId,
      plan: subscription.plan,
      payment_method_id: subscription.paymentMethodId,
      status: subscription.status,
      trial_ends_at: subscription.trialEndsAt,
      created_at: subscription.createdAt,
      updated_at: subscription.updatedAt
    });
  });

  // Cancel subscription
  app.post(
    "/subscriptions/:id/cancel",
    (req: Request, res: Response) => {
      try {
        const subscription =
          dependencies.subscriptionService.cancelSubscription(
            String(req.params.id)
          );

        return res.status(200).json({
          id: subscription.id,
          customer_id: subscription.customerId,
          plan: subscription.plan,
          status: subscription.status,
          updated_at: subscription.updatedAt
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Cancellation failed";

        const statusCode = message === "Subscription not found"
          ? 404
          : 400;

        return res.status(statusCode).json({ error: message });
      }
    }
  );

  return app;
}