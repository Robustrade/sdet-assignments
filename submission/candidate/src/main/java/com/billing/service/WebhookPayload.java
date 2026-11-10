package com.billing.service;

public record WebhookPayload(
    String eventId,
    String type,
    String subscriptionId,
    String invoiceId,
    int amount
) {}
