package com.robustrade.wallet.service.exception;

/** Malformed/invalid request that never became a real transfer attempt. Maps to HTTP 400. */
public class ValidationException extends RuntimeException {
    public ValidationException(String message) {
        super(message);
    }
}
