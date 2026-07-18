package com.wallet.fixture.service;

import com.wallet.fixture.model.TransferRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Deterministic fingerprint of a transfer request's business fields, used to detect "same
 * Idempotency-Key, different payload" misuse.
 */
final class RequestHasher {

	private RequestHasher() {
	}

	static String hash(TransferRequest request) {
		String canonical = String.join("|",
				nullToEmpty(request.sourceWalletId()),
				nullToEmpty(request.destinationWalletId()),
				Long.toString(request.amount()),
				nullToEmpty(request.currency()),
				nullToEmpty(request.reference()));
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			byte[] bytes = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(bytes);
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-256 not available", e);
		}
	}

	private static String nullToEmpty(String value) {
		return value == null ? "" : value;
	}
}
