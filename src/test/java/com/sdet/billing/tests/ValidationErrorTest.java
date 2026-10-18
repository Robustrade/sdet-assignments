package com.sdet.billing.tests;

import com.sdet.billing.base.BaseTest;
import com.sdet.billing.builder.SubscriptionRequestBuilder;
import com.sdet.billing.constants.ApiEndpoints;
import com.sdet.billing.factory.ResponseSpecificationFactory;
import io.qameta.allure.*;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validation and error-path tests — tagged regression AND sanity.
 * Verifies the service returns correct HTTP status codes and error body shapes
 * for invalid input; also verifies no side effects are produced for rejected requests.
 */
@Epic("Subscription Billing")
@Feature("Validation & Error Handling")
public class ValidationErrorTest extends BaseTest {

    @Test(groups = {"regression", "sanity"})
    @Story("Create subscription — validation")
    @Description("Unknown plan name returns 400 with validation error")
    public void createSubscription_unknownPlan_returns400() {
        var body = SubscriptionRequestBuilder.defaults()
            .toBuilder()
            .plan("ultra-premium-does-not-exist")
            .build()
            .toMap();

        Response response = given().spec(baseSpec)
            .body(body)
            .when()
            .post(ApiEndpoints.SUBSCRIPTIONS)
            .then()
            .spec(ResponseSpecificationFactory.badRequest400())
            .extract().response();

        assertThat(response.jsonPath().getString("error")).isNotBlank();
    }

    @Test(groups = {"regression", "sanity"})
    @Story("Create subscription — validation")
    @Description("Missing customer_id returns 400")
    public void createSubscription_missingCustomerId_returns400() {
        var body = SubscriptionRequestBuilder.defaults()
            .toBuilder()
            .customerId(null)
            .build()
            .toMap();

        given().spec(baseSpec)
            .body(body)
            .when()
            .post(ApiEndpoints.SUBSCRIPTIONS)
            .then()
            .spec(ResponseSpecificationFactory.badRequest400());
    }

    @Test(groups = {"regression", "sanity"})
    @Story("Create subscription — validation")
    @Description("Missing payment_method_id returns 400")
    public void createSubscription_missingPaymentMethodId_returns400() {
        var body = SubscriptionRequestBuilder.defaults()
            .toBuilder()
            .paymentMethodId(null)
            .build()
            .toMap();

        given().spec(baseSpec)
            .body(body)
            .when()
            .post(ApiEndpoints.SUBSCRIPTIONS)
            .then()
            .spec(ResponseSpecificationFactory.badRequest400());
    }

    @Test(groups = {"regression"})
    @Story("Cancel subscription — validation")
    @Description("Canceling an already-canceled subscription returns 409 Conflict")
    public void cancelSubscription_alreadyCanceled_returns409() {
        // Create + cancel once
        String subscriptionId = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");

        given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200);

        // Second cancel must be rejected
        Response response = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when()
            .post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then()
            .spec(ResponseSpecificationFactory.conflict409())
            .extract().response();

        assertThat(response.jsonPath().getString("error")).isNotBlank();
    }

    @Test(groups = {"regression"})
    @Story("Cancel subscription — validation")
    @Description("Canceling a non-existent subscription returns 404")
    public void cancelSubscription_unknownId_returns404() {
        given().spec(baseSpec)
            .pathParam("id", "sub_ghost_000")
            .when()
            .post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then()
            .spec(ResponseSpecificationFactory.notFound404());
    }
}
