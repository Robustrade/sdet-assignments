package com.wallet.client;

import com.wallet.config.TestConfig;
import io.restassured.response.Response;

import static io.restassured.RestAssured.given;

/**
 * HTTP client for the /wallets endpoint.
 * Nothing fancy — just GET by id for now.
 */
public class WalletClient {

    private final String baseUrl;

    // reads base URL from config — can be overridden via env for CI
    public WalletClient() {
        this(TestConfig.SERVICE_BASE_URL);
    }

    public WalletClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * GET /wallets/{id}
     */
    public Response getWallet(String walletId) {
        return given()
                .contentType("application/json")
                .accept("application/json")
                .log().ifValidationFails()
                .get(baseUrl + "/wallets/" + walletId);
    }
}
