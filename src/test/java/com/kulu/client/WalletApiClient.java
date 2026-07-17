package com.kulu.client;

import com.kulu.models.TransferRequest;
import com.kulu.utils.Config;
import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class WalletApiClient {

    private static final Logger log = LoggerFactory.getLogger(WalletApiClient.class);
    private final RequestSpecification baseSpec;

    public WalletApiClient() {
        this.baseSpec = new RequestSpecBuilder()
                .setBaseUri(Config.get("api.base.url"))
                .setContentType(ContentType.JSON)
                .build();
    }

    public Response initiateTransfer(TransferRequest requestBody, String idempotencyKey) {
        log.info("Initiating POST /transfers | Idempotency-Key: {}", idempotencyKey);

        return RestAssured.given()
                .spec(baseSpec)
                .header("Idempotency-Key", idempotencyKey)
                .body(requestBody)
                .log().all()
                .when()
                .post("/transfers")
                .then()
                .log().all()
                .extract()
                .response();
    }
}