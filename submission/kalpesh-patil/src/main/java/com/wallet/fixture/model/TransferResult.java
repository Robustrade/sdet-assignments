package com.wallet.fixture.model;

/**
 * Outcome of processing a transfer request. record is set whenever a transfer row was persisted
 * (COMPLETED or FAILED); it is null for requests rejected before processing started.
 */
public record TransferResult(
		int httpStatus,
		TransferRecord record,
		String errorCode,
		String errorMessage,
		boolean idempotentReplay) {

	public static TransferResult persisted(int httpStatus, TransferRecord record, boolean replay) {
		return new TransferResult(httpStatus, record, null, null, replay);
	}

	public static TransferResult rejected(int httpStatus, String errorCode, String errorMessage) {
		return new TransferResult(httpStatus, null, errorCode, errorMessage, false);
	}
}
