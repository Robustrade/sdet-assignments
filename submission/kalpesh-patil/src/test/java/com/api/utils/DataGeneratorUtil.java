package com.api.utils;

import java.util.UUID;

/** Generates unique readable identifiers so tests never collide on shared IDs. */
public class DataGeneratorUtil {

	private DataGeneratorUtil() {
	}

	public static String getWalletId() {
		return "wallet_" + getShortId();
	}

	public static String getIdempotencyKey() {
		return UUID.randomUUID().toString();
	}

	public static String getReference() {
		return "invoice_" + getShortId();
	}

	private static String getShortId() {
		return UUID.randomUUID().toString().substring(0, 8);
	}
}
