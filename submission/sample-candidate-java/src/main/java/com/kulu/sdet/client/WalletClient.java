package com.wallet.client;

import io.restassured.RestAssured;
import io.restassured.response.Response;

public class WalletClient {

    private static final String BASE_URL = "http://localhost:8080";

    /**
     * GET /wallets/{wallet_id}
     * Retrieves wallet details (like current balance).
     */
    public Response getWalletDetails(String walletId) {
        return RestAssured.given()
                .baseUri(BASE_URL)
                .pathParam("wallet_id", walletId)
                .get("/wallets/{wallet_id}");
    }
}