import request from "supertest";
import { createApp } from "../../src/app";
import { SubscriptionRequest } from "../builders/SubscriptionBuilder";

export interface BillingRequest {
    paymentMethodId: string;
    idempotencyKey: string;
}

export class SubscriptionApiClient {
    constructor(
        private readonly app: ReturnType<typeof createApp>
    ) { }

    createSubscription(data: Partial<SubscriptionRequest>) {
        return request(this.app)
            .post("/subscriptions")
            .send(data);
    }

    getSubscription(subscriptionId: string) {
        return request(this.app)
            .get(`/subscriptions/${subscriptionId}`);
    }

    billSubscription(
        subscriptionId: string,
        data: Partial<BillingRequest>
    ) {
        return request(this.app)
            .post(`/subscriptions/${subscriptionId}/bill`)
            .send(data);
    }
    changePlan(
        subscriptionId: string,
        data: { planId?: string }
    ) {
        return request(this.app)
            .post(`/subscriptions/${subscriptionId}/change-plan`)
            .send(data);
    }
    cancelSubscription(subscriptionId: string) {
        return request(this.app)
            .post(`/subscriptions/${subscriptionId}/cancel`);
    }

    sendWebhook(
        payload: string,
        signature?: string
    ) {
        const webhookRequest = request(this.app)
            .post("/webhooks/payment")
            .set("Content-Type", "application/json");

        if (signature !== undefined) {
            webhookRequest.set(
                "x-webhook-signature",
                signature
            );
        }

        return webhookRequest.send(payload);
    }
}