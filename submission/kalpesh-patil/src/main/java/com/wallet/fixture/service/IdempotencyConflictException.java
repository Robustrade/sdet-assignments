package com.wallet.fixture.service;

/** Same Idempotency-Key reused with a materially different request body. */
public class IdempotencyConflictException extends RuntimeException {
	public IdempotencyConflictException(String idempotencyKey) {
		super("Idempotency-Key '" + idempotencyKey + "' was already used with a different request body");
	}
}
