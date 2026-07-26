package com.api.constant;

public enum TransferStatus {

	COMPLETED("COMPLETED"),
	FAILED("FAILED");

	private final String value;

	TransferStatus(String value) {
		this.value = value;
	}

	public String getValue() {
		return value;
	}
}
