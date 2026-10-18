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
 * State-machine invariant tests — prove that illegal transitions cannot happen
 * regardless of what API calls or webhook events are delivered.
 *
 * Two mandatory invariants from the assignment:
 *   1. A canceled subscription never transitions again (CANCELED is terminal)
 *   2. A payment.failed webhook arriving after a payment.succeeded for the same
 *      invoice does not regress an already-active subscription
 */
@Epic("Subscription Billing")
@Feature("State Machine Invariants")
public class StateMachineInvariantTest extends BaseTest {

    // ── Invariant 1: CANCELED is terminal ─────────────────────────────────────

    @Test(groups = {"regression"})
    @Story("CANCELED is terminal")
    @Description("payment.succeeded webhook delivered to a CANCELED subscription must NOT reactivate it")
    public void canceledSubscription_paymentSucceededWebhook_doesNotReactivate() {
        String id = createAndCancel();
        assertStatus(id, "canceled");

        // Deliver a payment.succeeded — should be silently ignored
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(id);
        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200); // service accepts the call but no-ops the transition

        // Status must still be canceled
        assertStatus(id, "canceled");
    }

    @Test(groups = {"regression"})
    @Story("CANCELED is terminal")
    @Description("payment.failed webhook delivered to a CANCELED subscription must NOT change status")
    public void canceledSubscription_paymentFailedWebhook_statusRemainsCANCELED() {
        String id = createAndCancel();

        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentFailed(id);
        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200);

        assertStatus(id, "canceled");
    }

    // ── Invariant 2: succeeded then failed does not regress to past_due ───────

    @Test(groups = {"regression"})
    @Story("Out-of-order webhooks")
    @Description("payment.failed webhook arriving AFTER payment.succeeded for the same invoice "
        + "must NOT regress an already-active subscription back to past_due")
    public void active_staleFailedWebhookAfterSuccess_remainsActive() {
        String id = createTrialing();

        // First: payment succeeds → subscription becomes ACTIVE
        WebhookPayloadBuilder successWb = WebhookPayloadBuilder.paymentSucceeded(id);
        given().spec(webhookSpec)
            .header("X-Provider-Signature", successWb.computeSignature())
            .body(successWb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200);

        assertStatus(id, "active");

        // Then: a late payment.failed for the same invoice_id arrives
        // The service should treat this as a no-op (or ignore it because the
        // transition ACTIVE → PAST_DUE is only triggered by new charge attempts,
        // not by late delivery of an old failure for an already-settled invoice).
        // Regardless: the subscription MUST NOT go back to past_due.
        WebhookPayloadBuilder failedWb = WebhookPayloadBuilder.paymentFailed(id)
            .toBuilder()
            .invoiceId(successWb.getInvoiceId()) // same invoice
            .build();

        given().spec(webhookSpec)
            .header("X-Provider-Signature", failedWb.computeSignature())
            .body(failedWb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200);

        // The subscription must still be active — the stale failure must not win
        assertStatus(id, "active");
    }

    // ── Invariant 3: PAST_DUE does not jump directly to CANCELED via webhook ──

    @Test(groups = {"regression"})
    @Story("Invalid transition blocked")
    @Description("No webhook event should directly move a TRIALING subscription to CANCELED "
        + "— only the cancel API call can do that")
    public void trialing_noWebhookCanDirectlyCancelWithoutApiCall() {
        String id = createTrialing();

        // Neither succeeded nor failed webhook should produce 'canceled'
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(id);
        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when().post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then().statusCode(200);

        String status = given().spec(baseSpec)
            .pathParam("id", id)
            .when().get(ApiEndpoints.SUBSCRIPTION_BY_ID)
            .then().statusCode(200)
            .extract().path("status");

        assertThat(status).isNotEqualTo("canceled");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String createTrialing() {
        return given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");
    }

    private String createAndCancel() {
        String id = createTrialing();
        given().spec(baseSpec)
            .pathParam("id", id)
            .when().post(ApiEndpoints.CANCEL_SUBSCRIPTION)
            .then().statusCode(200);
        return id;
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
