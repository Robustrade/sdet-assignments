import express from "express";
import { SubscriptionController } from "../controllers/SubscriptionController";
import { WebhookController } from "../controllers/WebhookController";


export function createApp(
    subscriptionController: SubscriptionController,
    webhookController: WebhookController
){


    const app =
        express();



    app.use(
        express.json()
    );



    app.post(
        "/subscriptions",
        subscriptionController.create
    );



    app.get(
        "/subscriptions/:id",
        subscriptionController.get
    );



    app.post(
        "/subscriptions/:id/cancel",
        subscriptionController.cancel
    );



    app.post(
        "/webhooks/payment-provider",
        webhookController.handle
    );



    return app;

}