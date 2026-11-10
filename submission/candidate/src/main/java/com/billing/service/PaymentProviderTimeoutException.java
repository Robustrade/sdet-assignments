package com.billing.service;

public class PaymentProviderTimeoutException extends RuntimeException {

    public PaymentProviderTimeoutException(String message) {
        super(message);
    }
}
