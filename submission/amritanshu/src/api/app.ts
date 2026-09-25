import express, {
  type Express,
  type Request,
  type Response,
} from "express";

import { Buffer } from "node:buffer";

import { SubscriptionService } from "../services/subscription-service.js";
import { WebhookService } from "../services/webhook-service.js";
import {
  verifySignature,
} from "./signature.js";

export interface AppDependencies {
  subscriptionService: SubscriptionService;
  webhookService: WebhookService;
  webhookSecret: string;
}

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(
  dependencies: AppDependencies,
): Express {
  const app = express();

  /*
   * Capture the raw body before Express parses JSON.
   * The raw body is required for HMAC signature verification.
   */
  app.use(
    express.json({
      verify: (
        request,
        _response,
        buffer,
      ) => {
        const rawRequest = request as RawBodyRequest;
        rawRequest.rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.post(
    "/subscriptions",
    async (request: Request, response: Response) => {
      try {
        const {
          customer_id,
          plan,
          payment_method_id,
        } = request.body;

        const result =
          await dependencies.subscriptionService.createSubscription({
            customerId: customer_id,
            planId: plan,
            paymentMethodId: payment_method_id,
          });

        return response.status(201).json({
          id: result.subscription.id,
          customer_id: result.subscription.customerId,
          plan: result.subscription.planId,
          payment_method_id:
            result.subscription.paymentMethodId,
          status: result.subscription.state,
          created_at:
            result.subscription.createdAt.toISOString(),
          invoice: {
            id: result.invoice.id,
            amount: result.invoice.amountCents,
            currency: result.invoice.currency,
            status: result.invoice.status,
          },
          payment: {
            id: result.payment.id,
            status: result.payment.status,
            provider_reference:
              result.payment.providerReference,
          },
        });
      } catch (error) {
        return response.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to create subscription",
        });
      }
    },
  );

  app.get(
    "/subscriptions/:id",
    (request: Request, response: Response) => {
      try {
        const subscription =
          dependencies.subscriptionService.getSubscription(
            String(request.params.id),
);

        return response.status(200).json({
          id: subscription.id,
          customer_id: subscription.customerId,
          plan: subscription.planId,
          payment_method_id:
            subscription.paymentMethodId,
          status: subscription.state,
          created_at:
            subscription.createdAt.toISOString(),
          canceled_at:
            subscription.canceledAt?.toISOString() ?? null,
        });
      } catch (error) {
        return response.status(404).json({
          error:
            error instanceof Error
              ? error.message
              : "Subscription not found",
        });
      }
    },
  );

  app.post(
    "/subscriptions/:id/cancel",
    async (
      request: Request,
      response: Response,
    ) => {
      try {
        const subscription =
          await dependencies.subscriptionService.cancelSubscription(
            String(request.params.id),
          );

        return response.status(200).json({
          id: subscription.id,
          customer_id: subscription.customerId,
          plan: subscription.planId,
          payment_method_id:
            subscription.paymentMethodId,
          status: subscription.state,
          created_at:
            subscription.createdAt.toISOString(),
          canceled_at:
            subscription.canceledAt?.toISOString() ?? null,
        });
      } catch (error) {
        return response.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to cancel subscription",
        });
      }
    },
  );

  app.post(
    "/webhooks/payment-provider",
    (request: RawBodyRequest, response: Response) => {
      const signature =
        request.header("X-Provider-Signature");

      const rawBody =
        request.rawBody?.toString("utf8") ?? "";

      const validSignature = verifySignature(
        rawBody,
        signature,
        dependencies.webhookSecret,
      );

      if (!validSignature) {
        return response.status(401).json({
          error: "Invalid webhook signature",
        });
      }

      try {
        const {
          event_id,
          type,
          subscription_id,
          invoice_id,
          amount,
          currency,
        } = request.body;

        dependencies.webhookService.process({
          eventId: event_id,
          type,
          subscriptionId: subscription_id,
          invoiceId: invoice_id,
          amountCents: amount,
          currency,
        });

        return response.status(200).json({
          received: true,
        });
      } catch (error) {
        return response.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to process webhook",
        });
      }
    },
  );

  return app;
}