import { describe, test, expect, beforeEach } from "vitest"
import { BillingDatabase } from "../fixture/database"
import { createBillingApp } from "../fixture/server"
import { MockPaymentGateway } from "../src/mocks/MockPaymentGateway"
import { SubscriptionApiClient } from "../src/api/SubscriptionApiClient"
import { SubscriptionBuilder, WebhookEventBuilder } from "../src/builders/TestBuilders"
import { DatabaseAssertions } from "../src/assertions/DatabaseAssertions"

describe("Subscription & Billing Automated Validation Suite", () => {
    const db = new BillingDatabase(":memory:")
    const gateway = new MockPaymentGateway()
    const api = new SubscriptionApiClient(createBillingApp(db, gateway), gateway)
    const dbAssert = new DatabaseAssertions(db)

    beforeEach(() => {
        db.reset()
        gateway.clearHistory()
    })

    // 1. API Contract & Validation
    test("rejects missing fields (400), invalid plan (400), and unknown customer (404) without charging", async () => {
        expect((await api.createSubscription(new SubscriptionBuilder().removePlan().build())).status).toBe(400)
        expect((await api.createSubscription(new SubscriptionBuilder().setPlan("gold").build())).status).toBe(400)
        expect((await api.createSubscription(new SubscriptionBuilder().setCustomer("unknown").build())).status).toBe(404)
        expect(gateway.recordedCharges).toHaveLength(0)
    })

    test("rejects invalid webhook signatures (401) and malformed JSON/payloads (400)", async () => {
        const raw = JSON.stringify(new WebhookEventBuilder().build())
        expect((await api.sendRawWebhook(raw)).status).toBe(401)
        expect((await api.sendRawWebhook(raw, "bad_sig")).status).toBe(401)
        expect((await api.sendRawWebhook("{bad_json", gateway.createSignature("{bad_json"))).status).toBe(400)
        expect((await api.sendSignedWebhook(new WebhookEventBuilder().removeEventId().build())).status).toBe(400)
    })

    // 2. Plan Strategy & Mock Gateway Outcomes (Success, Decline, Timeout)
    test("Basic plan charges gateway once ($19) and persists active subscription + paid invoice", async () => {
        const res = await api.createSubscription(new SubscriptionBuilder().setPlan("basic").build())
        expect(res.status).toBe(201)
        expect(gateway.recordedCharges).toEqual([{ customerId: "cust_001", amount: 1900, currency: "USD", paymentMethodId: "pm_visa_4242" }])
        dbAssert.verifySubscription(res.body.id, "active", "basic")
        dbAssert.verifyInvoiceCount(res.body.id, 1, "paid")
    })

    test("handles gateway decline (past_due + failed invoice) and timeout (504)", async () => {
        gateway.setPaymentDeclined()
        const declined = await api.createSubscription(new SubscriptionBuilder().setPlan("basic").build())
        expect(declined.status).toBe(201)
        dbAssert.verifySubscription(declined.body.id, "past_due")
        dbAssert.verifyInvoiceCount(declined.body.id, 1, "failed")

        gateway.setPaymentTimeout()
        const timedOut = await api.createSubscription(new SubscriptionBuilder().setPlan("basic").build())
        expect(timedOut.status).toBe(504)
    })

    // 3. Full State Machine Transitions & Invalid Transition Guards
    test("exercises all valid lifecycle transitions (trialing -> active, past_due -> active, retries exhausted -> canceled, API cancel)", async () => {
        // Pro trial -> active -> past_due -> retries exhausted -> canceled
        const subId = (await api.createSubscription(new SubscriptionBuilder().setPlan("pro").build())).body.id
        dbAssert.verifySubscription(subId, "trialing", "pro")
        expect(gateway.recordedCharges).toHaveLength(0)

        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.succeeded").build())
        dbAssert.verifySubscription(subId, "active")

        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.failed").build())
        dbAssert.verifySubscription(subId, "past_due")

        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.succeeded").build())
        dbAssert.verifySubscription(subId, "active")

        // 3 consecutive failures -> canceled
        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.failed").build())
        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.failed").build())
        await api.sendSignedWebhook(new WebhookEventBuilder().setSubscription(subId).setType("payment.failed").build())
        dbAssert.verifySubscription(subId, "canceled")
        dbAssert.verifyAuditTrail(subId, ["trialing", "active", "past_due", "active", "past_due", "past_due", "canceled"])

        // trialing -> canceled via API
        const trialId = (await api.createSubscription(new SubscriptionBuilder().setPlan("pro").build())).body.id
        expect((await api.cancelSubscription(trialId)).status).toBe(200)
        dbAssert.verifySubscription(trialId, "canceled")
    })

    test("blocks invalid transitions: canceled subscription cannot reactivate or cancel twice, and trialing cannot refund", async () => {
        const subId = (await api.createSubscription(new SubscriptionBuilder().setPlan("pro").build())).body.id
        const refund = new WebhookEventBuilder().setSubscription(subId).setType("payment.refunded").build()
        expect((await api.sendSignedWebhook(refund)).status).toBe(409)

        await api.cancelSubscription(subId)
        expect((await api.cancelSubscription(subId)).status).toBe(409)

        const lateSuccess = new WebhookEventBuilder().setSubscription(subId).setType("payment.succeeded").build()
        expect((await api.sendSignedWebhook(lateSuccess)).status).toBe(409)
        dbAssert.verifySubscription(subId, "canceled")
        dbAssert.verifyWebhookResult(lateSuccess.event_id, "REJECTED_INVALID_TRANSITION")
    })

    // 4. Webhook Idempotency & Out-of-Order Delivery
    test("duplicate event_id is ignored as no-op and stale payment.failed after payment.succeeded does not regress active state", async () => {
        const subId = (await api.createSubscription(new SubscriptionBuilder().setPlan("pro").build())).body.id
        const successEv = new WebhookEventBuilder().setEventId("evt_once").setSubscription(subId).setInvoice("inv_1").setType("payment.succeeded").build()

        expect((await api.sendSignedWebhook(successEv)).body.status).toBe("processed")
        expect((await api.sendSignedWebhook(successEv)).body.status).toBe("ignored_duplicate")
        dbAssert.verifyInvoiceCount(subId, 1, "paid")

        // Stale failure for same inv_1 must be ignored
        const staleFail = new WebhookEventBuilder().setSubscription(subId).setInvoice("inv_1").setType("payment.failed").build()
        expect((await api.sendSignedWebhook(staleFail)).body.status).toBe("ignored_stale_event")
        dbAssert.verifySubscription(subId, "active")
    })
})
