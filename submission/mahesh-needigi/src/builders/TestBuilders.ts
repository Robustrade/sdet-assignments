import crypto from "crypto"

export class SubscriptionBuilder {
    readonly payload: any = { customer_id: "cust_001", plan: "pro", payment_method_id: "pm_visa_4242" }

    setCustomer(id: string) { this.payload.customer_id = id; return this }
    setPlan(plan: string) { this.payload.plan = plan; return this }
    removePlan() { delete this.payload.plan; return this }
    setpaymentmethod(id:string){this.payload.payment_method_id=id; return this}
    build() { return { ...this.payload } }
}

export class WebhookEventBuilder {
    readonly payload: any = {
        event_id: "evt_" + crypto.randomBytes(4).toString("hex"),
        type: "payment.succeeded",
        subscription_id: "sub_001",
        invoice_id: "inv_" + crypto.randomBytes(3).toString("hex"),
        amount: 4900,
        currency: "USD"
    }

    setEventId(id: string) { this.payload.event_id = id; return this }
    setSubscription(id: string) { this.payload.subscription_id = id; return this }
    setInvoice(id: string) { this.payload.invoice_id = id; return this }
    setType(type: string, amount = 4900) { this.payload.type = type; this.payload.amount = amount; return this }
    removeEventId() { delete this.payload.event_id; return this }
    build() { return { ...this.payload } }
}
