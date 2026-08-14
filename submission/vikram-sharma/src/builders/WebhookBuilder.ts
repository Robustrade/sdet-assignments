export class WebhookBuilder {
    private payload: any = { event_id: "evt_1", type: "payment.succeeded", subscription_id: "sub_001", invoice_id: "inv_1", amount: 4900, currency: "USD" };

    withEventId(id: string) { this.payload.event_id = id; return this; }
    withType(type: string) { this.payload.type = type; return this; }
    withSubscription(id: string) { this.payload.subscription_id = id; return this; }
    withInvoice(id: string) { this.payload.invoice_id = id; return this; }
    withAmount(amount: number) { this.payload.amount = amount; return this; }
    build() { return { ...this.payload }; }
}
