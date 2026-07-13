package com.kulu.sdet.client;

import com.kulu.sdet.model.WalletResponseBody;
import io.restassured.response.Response;

import static io.restassured.RestAssured.*;

public class WalletClient {

    public WalletResponseBody getById(String id) {
        Response response = given()
                .when()
                .get("/wallets/{id}", id);

        return toResponseBody(response);
    }

    private WalletResponseBody toResponseBody(Response response) {
        WalletResponseBody walletResponseBody = response.as(WalletResponseBody.class);
        walletResponseBody.setStatusCode(response.getStatusCode());

        return walletResponseBody;
    }

}
