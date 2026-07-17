package com.robustrade.wallet.service.exception;

/**
 * Thrown when:
 *  - the same Idempotency-Key is reused with a different request payload, or
 *  - the same Idempotency-Key is currently being processed by another
 *    in-flight request and hasn't finished yet.
 * Maps to HTTP 409.
 */
public class IdempotencyConflictException extends RuntimeException {
    public IdempotencyConflictException(String message) {
        super(message);
    }
}
