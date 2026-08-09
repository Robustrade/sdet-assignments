package com.robustrade.wallet.service;

/** Carries an HTTP status code alongside whatever DTO should be serialized as the body. */
public class ServiceResult {
    public final int statusCode;
    public final Object body;

    public ServiceResult(int statusCode, Object body) {
        this.statusCode = statusCode;
        this.body = body;
    }
}
