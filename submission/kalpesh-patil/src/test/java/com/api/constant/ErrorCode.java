package com.api.constant;

public enum ErrorCode {

	VALIDATION_ERROR("VALIDATION_ERROR"),
	MALFORMED_JSON("MALFORMED_JSON"),
	WALLET_NOT_FOUND("WALLET_NOT_FOUND"),
	TRANSFER_NOT_FOUND("TRANSFER_NOT_FOUND"),
	IDEMPOTENCY_KEY_CONFLICT("IDEMPOTENCY_KEY_CONFLICT");

	private final String value;

	ErrorCode(String value) {
		this.value = value;
	}

	public String getValue() {
		return value;
	}
}
