package com.api.constant;

public enum FailureReason {

	INSUFFICIENT_FUNDS("INSUFFICIENT_FUNDS");

	private final String value;

	FailureReason(String value) {
		this.value = value;
	}

	public String getValue() {
		return value;
	}
}
