package com.api.services;

import static io.restassured.RestAssured.given;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import io.restassured.http.ContentType;
import io.restassured.response.Response;

/**
 * All HTTP calls the suite makes. Tests never call given() directly; endpoints and headers live
 * here.
 */
public class TransferService {

	private static final String TRANSFERS_ENDPOINT = "/transfers";
	private static final String TRANSFER_BY_ID_ENDPOINT = "/transfers/{transferId}";
	private static final String WALLET_BY_ID_ENDPOINT = "/wallets/{walletId}";

	private static final String IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

	private static final Logger LOGGER = LogManager.getLogger(TransferService.class);

	// payload is Object so negative tests can send a Map/raw string with broken fields
	public Response createTransfer(Object payload, String idempotencyKey) {
		LOGGER.info("POST {} with Idempotency-Key {} and payload {}", TRANSFERS_ENDPOINT, idempotencyKey, payload);
		var spec = given().contentType(ContentType.JSON).body(payload);
		if (idempotencyKey != null) {
			spec = spec.header(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
		}
		return spec.when().post(TRANSFERS_ENDPOINT);
	}

	/** Sends the same payload under the same key -- the idempotent replay scenario. */
	public Response replayTransfer(Object payload, String idempotencyKey) {
		LOGGER.info("Replaying transfer request with Idempotency-Key {}", idempotencyKey);
		return createTransfer(payload, idempotencyKey);
	}

	public Response getTransfer(String transferId) {
		LOGGER.info("GET {} for transferId {}", TRANSFER_BY_ID_ENDPOINT, transferId);
		return given().when().get(TRANSFER_BY_ID_ENDPOINT, transferId);
	}

	public Response getWallet(String walletId) {
		LOGGER.info("GET {} for walletId {}", WALLET_BY_ID_ENDPOINT, walletId);
		return given().when().get(WALLET_BY_ID_ENDPOINT, walletId);
	}
}
