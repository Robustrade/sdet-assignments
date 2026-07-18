package com.wallet.fixture.service;

/** Request fails a business/contract validation rule (maps to HTTP 400). */
public class ValidationException extends RuntimeException {
	public ValidationException(String message) {
		super(message);
	}
}
