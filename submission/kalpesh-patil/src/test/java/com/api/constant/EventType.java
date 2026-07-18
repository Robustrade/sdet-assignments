package com.api.constant;

public enum EventType {

	TRANSFER_REQUESTED("TRANSFER_REQUESTED"),
	TRANSFER_COMPLETED("TRANSFER_COMPLETED"),
	TRANSFER_FAILED("TRANSFER_FAILED");

	private final String value;

	EventType(String value) {
		this.value = value;
	}

	public String getValue() {
		return value;
	}
}
