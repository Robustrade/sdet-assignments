package com.billing.pages;

import com.billing.builders.SubscriptionRequestBuilder;
import com.billing.context.AppContext;
import io.restassured.response.Response;

import java.util.Map;

import static io.restassured.RestAssured.given;

public class SubscriptionsPage {

    private final String baseUrl;

    public SubscriptionsPage() {
        this.baseUrl = AppContext.BASE_URL;
    }

    public Response create(Map<String, String> body) {
        return given()
            .baseUri(baseUrl)
            .contentType("application/json")
            .body(body)
            .when()
            .post("/subscriptions");
    }

    public Response createDefault() {
        return create(SubscriptionRequestBuilder.aSubscription().build());
    }

    public Response getById(String id) {
        return given()
            .baseUri(baseUrl)
            .when()
            .get("/subscriptions/{id}", id);
    }

    public Response cancel(String id) {
        return given()
            .baseUri(baseUrl)
            .when()
            .post("/subscriptions/{id}/cancel", id);
    }

    public String createAndGetId(Map<String, String> body) {
        return create(body).jsonPath().getString("id");
    }

    public String createDefaultAndGetId() {
        return createDefault().jsonPath().getString("id");
    }
}
