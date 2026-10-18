package com.sdet.billing.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum WebhookEventType {
    PAYMENT_SUCCEEDED("payment.succeeded"),
    PAYMENT_FAILED   ("payment.failed"),
    PAYMENT_REFUNDED ("payment.refunded");

    private final String wireValue;
}
