package com.billing.domain;

import java.time.Instant;

public class WebhookEvent {

    private final String eventId;
    private final String type;
    private final String subscriptionId;
    private final String invoiceId;
    private final boolean processed;
    private final Instant receivedAt;

    public WebhookEvent(String eventId, String type,
                        String subscriptionId, String invoiceId, boolean processed) {
        this.eventId = eventId;
        this.type = type;
        this.subscriptionId = subscriptionId;
        this.invoiceId = invoiceId;
        this.processed = processed;
        this.receivedAt = Instant.now();
    }

    public String getEventId()        { return eventId; }
    public String getType()           { return type; }
    public String getSubscriptionId() { return subscriptionId; }
    public String getInvoiceId()      { return invoiceId; }
    public boolean isProcessed()      { return processed; }
    public Instant getReceivedAt()    { return receivedAt; }
}
