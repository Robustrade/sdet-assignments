import request from "supertest"
import { Express } from "express"
import { MockPaymentGateway } from "../mocks/MockPaymentGateway"

export class SubscriptionApiClient {
    constructor(readonly app: Express, readonly gateway: MockPaymentGateway) {}

    createSubscription(payload: any) { return request(this.app).post("/subscriptions").send(payload) }
    getSubscription(id: string) { return request(this.app).get("/subscriptions/" + id) }
    cancelSubscription(id: string) { return request(this.app).post("/subscriptions/" + id + "/cancel").send() }

    sendSignedWebhook(payload: any) {
        const raw = JSON.stringify(payload)
        return request(this.app).post("/webhooks/payment-provider").set("Content-Type", "application/json").set("X-Provider-Signature", this.gateway.createSignature(raw)).send(raw)
    }

    sendRawWebhook(rawBody: string, sig?: string) {
        const req = request(this.app).post("/webhooks/payment-provider").set("Content-Type", "application/json")
        if (sig) req.set("X-Provider-Signature", sig)
        return req.send(rawBody)
    }
}
