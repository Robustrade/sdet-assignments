package com.wallet.client;

import com.wallet.config.TestConfig;
import io.restassured.response.Response;

import static io.restassured.RestAssured.given;

/**
 * Thin wrapper around RestAssured for the /wallets endpoint.
 */
public class WalletClient {

    private final String baseUrl;

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

