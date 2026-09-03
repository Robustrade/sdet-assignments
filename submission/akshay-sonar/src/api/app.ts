import express, { Request, Response } from "express";
import { SubscriptionStateMachine } from "../domain/SubscriptionStateMachine";
import { Plan } from "../domain/Plan";
import { AuditEventRepository } from "../repository/AuditEventRepository";
import { InvoiceRepository } from "../repository/InvoiceRepository";
import { PaymentRepository } from "../repository/PaymentRepository";
import { SubscriptionRepository } from "../repository/SubscriptionRepository";
import { WebhookEventRepository } from "../repository/WebhookEventRepository";
import { MockPaymentProvider } from "../provider/MockPaymentProvider";
import { SubscriptionService } from "../service/SubscriptionService";
import { WebhookService } from "../service/WebhookService";

export function createApp() {
  const app = express();

  const subscriptionRepository = new SubscriptionRepository();
  const invoiceRepository = new InvoiceRepository();
  const paymentRepository = new PaymentRepository();
  const webhookEventRepository = new WebhookEventRepository();
  const auditEventRepository = new AuditEventRepository();

  const paymentProvider = new MockPaymentProvider();
  const stateMachine = new SubscriptionStateMachine();

  const plans: Record<string, Plan> = {
    basic: {
      id: "basic",
      name: "Basic",
      priceInCents: 1900,
      trialDays: 7,
    },
    pro: {
      id: "pro",
      name: "Pro",
      priceInCents: 4900,
      trialDays: 14,
    },
  };

  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    invoiceRepository,
    paymentRepository,
    auditEventRepository,
    paymentProvider,
    stateMachine,
    plans
  );

  const webhookService = new WebhookService(
    subscriptionRepository,
    paymentRepository,
    invoiceRepository,
    webhookEventRepository,
    auditEventRepository,
    stateMachine,
    "test-webhook-secret"
  );

  // Webhook must receive the raw request body for HMAC verification.
  app.post(
    "/webhooks/payment-provider",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response) => {
      const rawBody = req.body.toString("utf8");
      const signature = req.header("X-Provider-Signature");

      if (!signature) {
        return res.status(401).json({
          error: "Missing X-Provider-Signature",
        });
      }

      if (!webhookService.verifySignature(rawBody, signature)) {
        return res.status(401).json({
          error: "Invalid webhook signature",
        });
      }

      try {
        const payload = JSON.parse(rawBody);

        webhookService.processWebhook(payload);

        return res.status(200).json({
          message: "Webhook processed",
        });
      } catch (error) {
        return res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Invalid webhook",
        });
      }
    }
  );

  app.use(express.json());

  // Create subscription
  app.post(
    "/subscriptions",
    (req: Request, res: Response) => {
      try {
        const { customerId, planId } = req.body;

        if (!customerId || !planId) {
          return res.status(400).json({
            error: "customerId and planId are required",
          });
        }

        if (!plans[planId]) {
          return res.status(400).json({
            error: "Invalid plan",
          });
        }

        const subscription =
          subscriptionService.createSubscription(
            customerId,
            planId
          );

        return res.status(201).json(subscription);
      } catch (error) {
        return res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Bad request",
        });
      }
    }
  );

  // Process payment
  app.post(
    "/subscriptions/:id/pay",
    async (req: Request, res: Response) => {
      try {
        const payment =
          await subscriptionService.processPayment(
            req.params.id as string
          );

        return res.status(200).json(payment);
      } catch (error) {
        return res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Payment failed",
        });
      }
    }
  );

  // Get subscription
  app.get(
    "/subscriptions/:id",
    (req: Request, res: Response) => {
      const subscription =
        subscriptionService.getSubscription(
          req.params.id as string
        );

      if (!subscription) {
        return res.status(404).json({
          error: "Subscription not found",
        });
      }

      return res.status(200).json(subscription);
    }
  );

  // Cancel subscription
  app.post(
    "/subscriptions/:id/cancel",
    (req: Request, res: Response) => {
      try {
        const subscription =
          subscriptionService.cancelSubscription(
            req.params.id as string
          );

        return res.status(200).json(subscription);
      } catch (error) {
        return res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to cancel",
        });
      }
    }
  );

  return {
    app,
    subscriptionRepository,
    invoiceRepository,
    paymentRepository,
    webhookEventRepository,
    auditEventRepository,
    paymentProvider,
    subscriptionService,
    webhookService,
  };
}

// Start the application only when this file is executed directly.
if (process.env.NODE_ENV !== "test") {
  const server = createApp();

  server.app.listen(3000, () => {
    console.log(
      "Subscription & Billing service running on port 3000"
    );
  });
}