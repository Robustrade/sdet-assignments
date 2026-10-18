package com.sdet.billing.tests;

import com.sdet.billing.base.BaseTest;
import com.sdet.billing.builder.SubscriptionRequestBuilder;
import com.sdet.billing.constants.ApiEndpoints;
import com.sdet.billing.enums.PlanType;
import com.sdet.billing.factory.ResponseSpecificationFactory;
import io.qameta.allure.*;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Smoke-level CRUD tests — tagged regression AND sanity so they run in both suites.
 */
@Epic("Subscription Billing")
@Feature("Subscription CRUD")
public class SubscriptionCrudTest extends BaseTest {

    @Test(groups = {"regression", "sanity"})
    @Story("Create subscription")
    @Description("POST /subscriptions with valid PRO plan returns 201 and trialing status")
    public void createSubscription_validProPlan_returns201AndTrialingStatus() {
        Response response = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when()
            .post(ApiEndpoints.SUBSCRIPTIONS)
            .then()
            .spec(ResponseSpecificationFactory.created201())
            .extract().response();

        assertThat(response.jsonPath().getString("status")).isEqualTo("trialing");
        assertThat(response.jsonPath().getString("plan")).isEqualTo(PlanType.PRO.getApiValue());
        assertThat(response.jsonPath().getInt("price_cents")).isEqualTo(PlanType.PRO.getPriceInCents());
        assertThat(response.jsonPath().getString("id")).startsWith("sub_");
    }

    @Test(groups = {"regression", "sanity"})
    @Story("Create subscription")
    @Description("POST /subscriptions with valid BASIC plan returns 201")
    public void createSubscription_validBasicPlan_returns201() {
        Response response = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.basicPlan().toMap())
            .when()
            .post(ApiEndpoints.SUBSCRIPTIONS)
            .then()
            .spec(ResponseSpecificationFactory.created201())
            .extract().response();

        assertThat(response.jsonPath().getString("plan")).isEqualTo(PlanType.BASIC.getApiValue());
    }

    @Test(groups = {"regression", "sanity"})
    @Story("Get subscription")
    @Description("GET /subscriptions/{id} for an existing subscription returns 200 with correct data")
    public void getSubscription_existingId_returns200WithCorrectData() {
        // Create first
        String subscriptionId = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");

        // Then get
        Response response = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when()
            .get(ApiEndpoints.SUBSCRIPTION_BY_ID)
            .then()
            .spec(ResponseSpecificationFactory.ok200())
            .extract().response();

        assertThat(response.jsonPath().getString("id")).isEqualTo(subscriptionId);
        assertThat(response.jsonPath().getString("status")).isEqualTo("trialing");
    }

    @Test(groups = {"regression", "sanity"})
    @Story("Get subscription")
    @Description("GET /subscriptions/{id} for an unknown id returns 404")
    public void getSubscription_unknownId_returns404() {
        given().spec(baseSpec)
            .pathParam("id", "sub_does_not_exist")
            .when()
            .get(ApiEndpoints.SUBSCRIPTION_BY_ID)
            .then()
            .spec(ResponseSpecificationFactory.notFound404());
    }

    @Test(groups = {"regression"})
    @Story("Cancel subscription")
    @Description("POST /subscriptions/{id}/cancel on an active subscription returns 200 and canceled status")
    public void cancelSubscription_trialing_returns200AndCanceledStatus() {
        String subscriptionId = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");

        Response response = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when()
            .post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then()
            .spec(ResponseSpecificationFactory.ok200())
            .extract().response();

        assertThat(response.jsonPath().getString("status")).isEqualTo("canceled");
        assertThat(response.jsonPath().getString("canceled_at")).isNotNull();
    }

    @Test(groups = {"regression"})
    @Story("Cancel subscription")
    @Description("Response body contains all expected fields on cancellation")
    public void cancelSubscription_responseBodyIsComplete() {
        String subscriptionId = given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");

        Response response = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200)
            .extract().response();

        assertThat(response.jsonPath().getString("id")).isEqualTo(subscriptionId);
        assertThat(response.jsonPath().getString("customer_id")).isNotNull();
        assertThat(response.jsonPath().getString("plan")).isNotNull();
        assertThat(response.jsonPath().getString("status")).isEqualTo("canceled");
    }
}
