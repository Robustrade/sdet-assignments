package com.wallet.fixture.model;

import java.time.Instant;

/** A persisted transfer row, shared by the POST /transfers response and GET /transfers/{id}. */
public record TransferRecord(
		String transferId,
		String sourceWalletId,
		String destinationWalletId,
		long amount,
		String currency,
		String reference,
		String status,
		String failureReason,
		Instant createdAt,
		Instant completedAt) {}
