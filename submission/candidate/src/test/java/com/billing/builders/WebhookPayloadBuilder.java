package com.billing.builders;

import java.util.UUID;

public class WebhookPayloadBuilder {

    private String eventId        = "evt_" + UUID.randomUUID().toString().substring(0, 8);
    private String type           = "payment.succeeded";
    private String subscriptionId = "sub_001";
    private String invoiceId      = "inv_001";
    private int    amount         = 4900;

    public static WebhookPayloadBuilder aWebhookEvent() {
        return new WebhookPayloadBuilder();
    }

    public static WebhookPayloadBuilder aPaymentSucceeded(String subscriptionId, String invoiceId) {
        return new WebhookPayloadBuilder()
            .withType("payment.succeeded")
            .withSubscriptionId(subscriptionId)
            .withInvoiceId(invoiceId);
    }

    public static WebhookPayloadBuilder aPaymentFailed(String subscriptionId, String invoiceId) {
        return new WebhookPayloadBuilder()
            .withType("payment.failed")
            .withSubscriptionId(subscriptionId)
            .withInvoiceId(invoiceId);
    }

    public static WebhookPayloadBuilder aPaymentRefunded(String subscriptionId, String invoiceId) {
        return new WebhookPayloadBuilder()
            .withType("payment.refunded")
            .withSubscriptionId(subscriptionId)
            .withInvoiceId(invoiceId);
    }

    public WebhookPayloadBuilder withEventId(String eventId) {
        this.eventId = eventId;
        return this;
    }

    public WebhookPayloadBuilder withType(String type) {
        this.type = type;
        return this;
    }

    public WebhookPayloadBuilder withSubscriptionId(String subscriptionId) {
        this.subscriptionId = subscriptionId;
        return this;
    }

    public WebhookPayloadBuilder withInvoiceId(String invoiceId) {
        this.invoiceId = invoiceId;
        return this;
    }

    public WebhookPayloadBuilder withAmount(int amount) {
        this.amount = amount;
        return this;
    }

    public String getEventId()        { return eventId; }
    public String getType()           { return type; }
    public String getSubscriptionId() { return subscriptionId; }
    public String getInvoiceId()      { return invoiceId; }
    public int    getAmount()         { return amount; }
}
