package com.sdet.billing.tests;

import com.sdet.billing.base.BaseTest;
import com.sdet.billing.builder.SubscriptionRequestBuilder;
import com.sdet.billing.builder.WebhookPayloadBuilder;
import com.sdet.billing.constants.ApiEndpoints;
import io.qameta.allure.*;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * State-machine / lifecycle tests — every valid transition is exercised via
 * the appropriate trigger (API call or webhook event).
 *
 * Each test follows the pattern:
 *   1. Arrange  — create a subscription in a known start state
 *   2. Act      — send the trigger (webhook / cancel API)
 *   3. Assert   — verify the new status via GET /subscriptions/{id}
 */
@Epic("Subscription Billing")
@Feature("Subscription Lifecycle")
public class SubscriptionLifecycleTest extends BaseTest {

    // ── TRIALING → ACTIVE ─────────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("TRIALING → ACTIVE")
    @Description("payment.succeeded webhook on a trialing subscription transitions it to active")
    public void trialing_paymentSucceeded_transitionsToActive() {
        String id = createTrialing();

        sendWebhook(WebhookPayloadBuilder.paymentSucceeded(id));

        assertStatus(id, "active");
    }

    // ── TRIALING → PAST_DUE ───────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("TRIALING → PAST_DUE")
    @Description("payment.failed webhook on a trialing subscription transitions it to past_due")
    public void trialing_paymentFailed_transitionsToPastDue() {
        String id = createTrialing();

        sendWebhook(WebhookPayloadBuilder.paymentFailed(id));

        assertStatus(id, "past_due");
    }

    // ── TRIALING → CANCELED ───────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("TRIALING → CANCELED")
    @Description("Cancel API call on a trialing subscription transitions it to canceled")
    public void trialing_cancelApi_transitionsToCanceled() {
        String id = createTrialing();

        given().spec(baseSpec)
            .pathParam("id", id)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200);

        assertStatus(id, "canceled");
    }

    // ── ACTIVE → PAST_DUE ─────────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("ACTIVE → PAST_DUE")
    @Description("payment.failed webhook on an active subscription transitions it to past_due")
    public void active_paymentFailed_transitionsToPastDue() {
        String id = createTrialing();
        sendWebhook(WebhookPayloadBuilder.paymentSucceeded(id)); // → ACTIVE
        assertStatus(id, "active");

        sendWebhook(WebhookPayloadBuilder.paymentFailed(id));    // → PAST_DUE

        assertStatus(id, "past_due");
    }

    // ── ACTIVE → CANCELED ─────────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("ACTIVE → CANCELED")
    @Description("Cancel API call on an active subscription transitions it to canceled")
    public void active_cancelApi_transitionsToCanceled() {
        String id = createTrialing();
        sendWebhook(WebhookPayloadBuilder.paymentSucceeded(id)); // → ACTIVE

        given().spec(baseSpec)
            .pathParam("id", id)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200);

        assertStatus(id, "canceled");
    }

    // ── PAST_DUE → ACTIVE ─────────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("PAST_DUE → ACTIVE")
    @Description("payment.succeeded webhook on a past_due subscription (retry succeeds) transitions to active")
    public void pastDue_retrySucceeds_transitionsToActive() {
        String id = createTrialing();
        sendWebhook(WebhookPayloadBuilder.paymentFailed(id));    // → PAST_DUE
        assertStatus(id, "past_due");

        sendWebhook(WebhookPayloadBuilder.paymentSucceeded(id)); // → ACTIVE

        assertStatus(id, "active");
    }

    // ── PAST_DUE → CANCELED ───────────────────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("PAST_DUE → CANCELED")
    @Description("Cancel API call on a past_due subscription (retries exhausted) transitions to canceled")
    public void pastDue_cancelApi_transitionsToCanceled() {
        String id = createTrialing();
        sendWebhook(WebhookPayloadBuilder.paymentFailed(id));    // → PAST_DUE

        given().spec(baseSpec)
            .pathParam("id", id)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200);

        assertStatus(id, "canceled");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String createTrialing() {
        return given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");
    }

    private void sendWebhook(WebhookPayloadBuilder wb) {
        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200);
    }

    private void assertStatus(String subscriptionId, String expectedStatus) {
        String actual = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when().get(ApiEndpoints.SUBSCRIPTION_BY_ID)
            .then().statusCode(200)
            .extract().path("status");
        assertThat(actual).isEqualTo(expectedStatus);
    }
}
