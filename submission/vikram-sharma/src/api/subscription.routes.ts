import { Router } from "express";
import { SubscriptionService } from "../services/SubscriptionService";
import { PaymentProvider, FakePaymentProvider } from "../payment/PaymentProvider";

export function createRouter(provider?: PaymentProvider) {
    const router = Router();
    const subscriptionService = new SubscriptionService({ provider: provider || new FakePaymentProvider() });

    router.post("/subscriptions", async (req, res) => {
        const result = await subscriptionService.createSubscription(req.body);
        // result may be a Promise-resolved object
        if (result && (result as any).status) return res.status((result as any).status).json((result as any).body);
        return res.status(201).json(result);
    });

    router.post("/subscriptions/:id/cancel", (req, res) => {
        const result = subscriptionService.cancelSubscription(req.params.id);
        return res.status(result.status).json(result.body);
    });

    router.post("/webhooks/payment-provider", (req: any, res) => {
        let raw: string;
        if (typeof req.body === "string") raw = req.body;
        else raw = JSON.stringify(req.body);
        const sig = req.header("X-Provider-Signature");
        subscriptionService.handleWebhook(raw, sig).then(r => res.status(r.status).json(r.body)).catch(err => {
            console.error(err);
            res.status(500).json({ error: err.message });
        });
    });

    return router;
}

import express from "express";

export default createRouter();