
import express from "express";
import { SubscriptionService } from "./services/SubscriptionService";
import { SubscriptionStateMachine } from "./domain/SubscriptionStateMachine";
import { InMemorySubscriptionRepository } from "./repositories/InMemorySubscriptionRepository";

export function createApp() {
  const app = express();
  app.use(express.json());

  const repository = new InMemorySubscriptionRepository();
  const service = new SubscriptionService(
    repository,
    new SubscriptionStateMachine()
  );

  app.post("/subscriptions", async (req, res) => {
    try {
      const { customerId, planId } = req.body ?? {};

      const subscription = await service.createSubscription(
        customerId,
        planId
      );

      res.status(201).json(subscription);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Bad request"
      });
    }
  });

  app.get("/subscriptions/:id", async (req, res) => {
    const subscription = await service.getSubscription(
      String(req.params.id)
    );

    if (!subscription) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    res.status(200).json(subscription);
  });

  return app;
}
