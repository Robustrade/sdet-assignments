package com.kulu.sdet.support;

import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.filter.log.RequestLoggingFilter;
import io.restassured.filter.log.ResponseLoggingFilter;
import io.restassured.http.ContentType;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;

import java.util.Map;

public class ApiClient {

    private final RequestSpecification spec;

    public ApiClient() {
        this(TestConfig.BASE_URL);
    }

    public ApiClient(String baseUrl) {
        spec = new RequestSpecBuilder().setBaseUri(baseUrl).setContentType(ContentType.JSON).setAccept(ContentType.JSON).addFilter(new RequestLoggingFilter()).addFilter(new ResponseLoggingFilter()).build();
    }


    public ValidatableResponse getWallet(String walletId) {
        return RestAssured.given(spec).get(TestConfig.WALLET_BASE_PATH + "/{id}", walletId).then();
    }

    public ValidatableResponse transfer(Map<String, Object> payload) {
        return RestAssured.given(spec).body(payload).post(TestConfig.WALLET_BASE_PATH + "/transfer").then();
    }

    public ValidatableResponse transfer(Map<String, Object> payload, String idempotencyKey) {
        return RestAssured.given(spec).header("Idempotency-Key", idempotencyKey).body(payload).post(TestConfig.WALLET_BASE_PATH + "/transfer").then();
    }

    public ValidatableResponse getTransactions(String walletId) {
        return RestAssured.given(spec).get(TestConfig.WALLET_BASE_PATH + "/{id}/transactions", walletId).then();
    }


    public RequestSpecification given() {
        return RestAssured.given(spec);
    }
}
