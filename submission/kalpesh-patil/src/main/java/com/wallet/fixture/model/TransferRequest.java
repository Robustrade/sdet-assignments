package com.wallet.fixture.model;

/** Wire-format request body for POST /transfers. */
public record TransferRequest(
		String sourceWalletId,
		String destinationWalletId,
		long amount,
		String currency,
		String reference) {}
