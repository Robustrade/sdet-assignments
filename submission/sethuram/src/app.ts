
import express from "express";
import { SubscriptionService } from "./services/SubscriptionService";
import { SubscriptionStateMachine } from "./domain/SubscriptionStateMachine";
import { InMemorySubscriptionRepository } from "./repositories/InMemorySubscriptionRepository";
import { InMemoryInvoiceRepository } from "./repositories/InMemoryInvoiceRepository";
import { MockPaymentProvider } from "./providers/MockPaymentProvider";
import { PlanCatalog } from "./domain/Plan";
import { BillingService } from "./services/BillingService";
import { InMemoryWebhookEventRepository } from "./repositories/InMemoryWebhookEventRepository";
import { WebhookSignature } from "./services/WebhookSignature";
import { WebhookService } from "./services/WebhookService";
import { PaymentProvider } from "./providers/PaymentProvider";
import { InvoiceRepository } from "./repositories/InvoiceRepository";
import { SubscriptionRepository } from "./repositories/SubscriptionRepository";
import { WebhookEventRepository } from "./repositories/WebhookEventRepository";


export function createApp(
  webhookSecret = process.env.WEBHOOK_SECRET ?? "test_secret",
  paymentProvider: PaymentProvider = new MockPaymentProvider(),
  invoiceRepository: InvoiceRepository = new InMemoryInvoiceRepository(),
  repository: SubscriptionRepository = new InMemorySubscriptionRepository(),
  eventRepository: WebhookEventRepository = new InMemoryWebhookEventRepository()
) {
  const app = express();

  const planCatalog = new PlanCatalog();

  const signatureVerifier =
    new WebhookSignature(webhookSecret);

  const service = new SubscriptionService(
    repository,
    new SubscriptionStateMachine(),
    planCatalog,
    undefined,
    invoiceRepository
  );

  const billingService = new BillingService(
    service,
    invoiceRepository,
    paymentProvider,
    planCatalog
  );

  const webhookService = new WebhookService(
    invoiceRepository,
    eventRepository,
    service,
    signatureVerifier
  );

  // Webhook endpoint uses the original raw request body.
  app.post(
    "/webhooks/payment",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const signature = req.get("x-webhook-signature");

        if (!signature) {
          res.status(401).json({
            error: "Missing webhook signature"
          });
          return;
        }

        if (!Buffer.isBuffer(req.body)) {
          res.status(400).json({
            error: "Invalid webhook payload"
          });
          return;
        }

        const payload = req.body.toString("utf8");

        const result = await webhookService.process(
          payload,
          signature
        );

        res.status(200).json({
          status: result
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Internal server error";

        if (message === "Invalid webhook signature") {
          res.status(401).json({ error: message });
        } else if (
          message === "Invoice not found" ||
          message === "Subscription not found"
        ) {
          res.status(404).json({ error: message });
        } else if (
          [
            "Invalid webhook payload",
            "Invalid webhook event",
            "Unsupported webhook event",
            "Subscription mismatch",
            "Invoice amount or currency mismatch",
            "Only paid invoices can be refunded"
          ].includes(message)
        ) {
          res.status(400).json({ error: message });
        } else {
          res.status(500).json({
            error: "Internal server error"
          });
        }
      }
    }
  );

  app.use(express.json());

  app.post("/subscriptions", async (req, res) => {
    try {
      const { customerId, planId, paymentMethodId } =
        req.body ?? {};

      if (
        typeof customerId !== "string" ||
        typeof planId !== "string" ||
        !customerId.trim() ||
        !planId.trim()
      ) {
        throw new Error(
          "Customer ID and Plan ID are required"
        );
      }

      const plan = planCatalog.getPlan(planId);

      if (
        plan.trialDays === 0 &&
        (
          typeof paymentMethodId !== "string" ||
          !paymentMethodId.trim()
        )
      ) {
        throw new Error("Payment method is required");
      }

      const subscription = await service.createSubscription(
        customerId,
        planId
      );

      if (plan.trialDays === 0) {
        await billingService.billSubscription(
          subscription.id,
          paymentMethodId,
          `initial_billing_${subscription.id}`
        );

        const updated = await service.getSubscription(
          subscription.id
        );

        res.status(201).json(updated);
        return;
      }

      res.status(201).json(subscription);

    } catch (error) {
      res.status(400).json({
        error: error instanceof Error
          ? error.message
          : "Bad request"
      });
    }
  });

  app.get("/subscriptions/:id", async (req, res) => {
    const subscription = await service.getSubscription(
      String(req.params.id)
    );

    if (!subscription) {
      res.status(404).json({
        error: "Subscription not found"
      });
      return;
    }

    res.status(200).json(subscription);
  });

  app.post("/subscriptions/:id/bill", async (req, res) => {
    try {
      const { paymentMethodId, idempotencyKey } =
        req.body ?? {};

      if (
        typeof paymentMethodId !== "string" ||
        typeof idempotencyKey !== "string"
      ) {
        res.status(400).json({
          error: "Payment method and idempotency key are required"
        });
        return;
      }

      const invoice = await billingService.billSubscription(
        String(req.params.id),
        paymentMethodId,
        idempotencyKey
      );

      res.status(200).json(invoice);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Internal server error";

      if (message === "Subscription not found") {
        res.status(404).json({ error: message });
      } else if (message === "Idempotency key conflict") {
        res.status(409).json({ error: message });
      } else if (
        message === "Cannot bill a canceled subscription" ||
        message === "Invalid plan" ||
        message === "Payment method and idempotency key are required"
      ) {
        res.status(400).json({ error: message });
      } else {
        res.status(500).json({
          error: "Internal server error"
        });
      }
    }
  });
  app.post("/subscriptions/:id/change-plan", async (req, res) => {
    try {
      const { planId } = req.body ?? {};

      const updated = await service.changePlan(
        req.params.id,
        planId
      );

      res.status(200).json(updated);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Bad request";

      if (message === "Subscription not found") {
        res.status(404).json({ error: message });
        return;
      }

      if (message === "Canceled subscription cannot change plan") {
        res.status(409).json({ error: message });
        return;
      }

      res.status(400).json({ error: message });
    }
  });
  app.post("/subscriptions/:id/cancel", async (req, res) => {
    try {
      const subscriptionId = String(req.params.id);

      const subscription =
        await service.getSubscription(subscriptionId);

      if (!subscription) {
        res.status(404).json({
          error: "Subscription not found"
        });
        return;
      }

      if (subscription.status === "canceled") {
        res.status(409).json({
          error: "Subscription is already canceled"
        });
        return;
      }

      const canceled = await service.changeStatus(
        subscriptionId,
        "canceled"
      );

      res.status(200).json(canceled);

    } catch (error) {
      res.status(500).json({
        error: "Internal server error"
      });
    }
  });

  return app;
}
