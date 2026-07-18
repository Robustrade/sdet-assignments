package com.wallet.fixture.service;

/** Referenced wallet does not exist (maps to HTTP 404). */
public class WalletNotFoundException extends RuntimeException {
	public WalletNotFoundException(String walletId) {
		super("Wallet not found: " + walletId);
	}
}
