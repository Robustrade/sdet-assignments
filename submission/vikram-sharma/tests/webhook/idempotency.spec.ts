import express from "express";
import request from "supertest";
import { createRouter } from "../../src/api/subscription.routes";
import { SubscriptionRepository } from "../../src/repositories/SubscriptionRepository";
import { Subscription } from "../../src/domain/Subscription";
import { SubscriptionStatus } from "../../src/domain/SubscriptionStatus";
import crypto from "crypto";
import { InvoiceRepository } from "../../src/repositories/InvoiceRepository";

function sign(payload: string) {
    return crypto.createHmac("sha256", "test_secret").update(payload).digest("hex");
}

describe("Webhook idempotency", () => {
    test("duplicate delivery is idempotent and does not create duplicate invoices", async () => {
        const app = express();
        app.use(express.json());
        app.use(createRouter());

        const subRepo = new SubscriptionRepository();
        const sub = new Subscription("sub_test", "cust_1", "pro", "pm_1", SubscriptionStatus.TRIALING);
        subRepo.save(sub);

        const payload = JSON.stringify({ event_id: "evt_dup", type: "payment.succeeded", subscription_id: "sub_test", invoice_id: "inv_1", amount: 4900, currency: "USD" });
        const sig = sign(payload);

        // first delivery
        const r1 = await request(app).post("/webhooks/payment-provider").set("X-Provider-Signature", sig).set("Content-Type","application/json").send(payload);
        expect(r1.status).toBe(200);
        // second delivery (duplicate)
        const r2 = await request(app).post("/webhooks/payment-provider").set("X-Provider-Signature", sig).set("Content-Type","application/json").send(payload);
        expect(r2.status).toBe(200);

        const invRepo = new InvoiceRepository();
        const count = invRepo.countForSubscription("sub_test");
        expect(count).toBe(1);
    });

    test("invalid signature is rejected", async () => {
        const app = express();
        app.use(express.json());
        app.use(createRouter());

        const payload = JSON.stringify({ event_id: "evt_bad", type: "payment.succeeded", subscription_id: "nope", invoice_id: "inv_x", amount: 100 });
        const r = await request(app).post("/webhooks/payment-provider").set("X-Provider-Signature", "bad_sig").set("Content-Type","application/json").send(payload);
        expect(r.status).toBe(400);
    });
});
