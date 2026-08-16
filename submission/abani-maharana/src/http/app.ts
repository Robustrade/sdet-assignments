import express from "express";

import { BillingService } from "../services/billing.service";

import { InMemorySubscriptionRepository } from "../repositories/in-memory.repository";

import { SubscriptionStateMachine } from "../domain/subscription";

import { PaymentProvider } from "../providers/payment-provider";

import { createRoutes } from "./routes";

export interface AppDependencies {
  repository: InMemorySubscriptionRepository;

  paymentProvider: PaymentProvider;

  stateMachine: SubscriptionStateMachine;

  webhookSecret: string;
}

export function createApp(dependencies: AppDependencies) {
  const billingService = new BillingService(
    dependencies.repository,
    dependencies.paymentProvider,
    dependencies.stateMachine,
  );

  const app = express();

  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (
          request as typeof request & {
            rawBody?: string;
          }
        ).rawBody = buffer.toString("utf8");
      },
    }),
  );

  app.use(
    createRoutes({
      billingService,
      webhookSecret: dependencies.webhookSecret,
    }),
  );

  return app;
}
