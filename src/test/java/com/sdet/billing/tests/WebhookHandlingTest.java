package com.sdet.billing.tests;

import com.sdet.billing.base.BaseTest;
import com.sdet.billing.builder.SubscriptionRequestBuilder;
import com.sdet.billing.builder.WebhookPayloadBuilder;
import com.sdet.billing.constants.ApiEndpoints;
import com.sdet.billing.factory.ResponseSpecificationFactory;
import io.qameta.allure.*;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;

/**
 * Webhook endpoint contract tests — validate the /webhooks/payment-provider endpoint
 * for correct handling of valid/invalid signatures and malformed payloads.
 */
@Epic("Subscription Billing")
@Feature("Webhook Handling")
public class WebhookHandlingTest extends BaseTest {

    @Test(groups = {"regression"})
    @Story("Webhook signature validation")
    @Description("Webhook with a valid HMAC-SHA256 signature is accepted (200 OK)")
    public void webhook_validSignature_returns200() {
        String subscriptionId = createTrialingSubscription();
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId);

        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .statusCode(200);
    }

    @Test(groups = {"regression"})
    @Story("Webhook signature validation")
    @Description("Webhook with an invalid signature is rejected (401 Unauthorized)")
    public void webhook_invalidSignature_returns401() {
        String subscriptionId = createTrialingSubscription();
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId);

        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.invalidSignature())
            .body(wb.toMap())
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .spec(ResponseSpecificationFactory.unauthorized401());
    }

    @Test(groups = {"regression"})
    @Story("Webhook signature validation")
    @Description("Webhook with missing X-Provider-Signature header is rejected (401)")
    public void webhook_missingSignatureHeader_returns401() {
        String subscriptionId = createTrialingSubscription();
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId);

        given().spec(webhookSpec)
            // no signature header
            .body(wb.toMap())
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .spec(ResponseSpecificationFactory.unauthorized401());
    }

    @Test(groups = {"regression"})
    @Story("Webhook signature validation")
    @Description("Webhook with wrong secret (signed with different key) is rejected (401)")
    public void webhook_signedWithWrongSecret_returns401() {
        String subscriptionId = createTrialingSubscription();
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId);

        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignatureWithSecret("completely-wrong-secret"))
            .body(wb.toMap())
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .spec(ResponseSpecificationFactory.unauthorized401());
    }

    @Test(groups = {"regression"})
    @Story("Webhook payload validation")
    @Description("Malformed (non-JSON) webhook body returns 400 Bad Request")
    public void webhook_malformedBody_returns400() {
        // Sign the raw string so sig check passes, then payload parse fails
        String rawBody = "this is not json at all }{";
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded("sub_dummy");
        String sig = wb.computeSignatureWithSecret(
            com.sdet.billing.config.TestApiConfig.get().getWebhookSecret()
        );
        // Recompute over the actual raw body we'll send
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new javax.crypto.spec.SecretKeySpec(
                com.sdet.billing.config.TestApiConfig.get().getWebhookSecret()
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
            sig = org.apache.commons.codec.binary.Hex.encodeHexString(
                mac.doFinal(rawBody.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception ignored) {}

        given().spec(webhookSpec)
            .header("X-Provider-Signature", sig)
            .body(rawBody)
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .spec(ResponseSpecificationFactory.badRequest400());
    }

    @Test(groups = {"regression"})
    @Story("Webhook unknown event type")
    @Description("Unknown event type is accepted (200) but causes no state change — service must not blow up")
    public void webhook_unknownEventType_returns200AndIsNoOp() {
        String subscriptionId = createTrialingSubscription();
        WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId)
            .toBuilder()
            .type("subscription.unknown_future_event")
            .build();

        given().spec(webhookSpec)
            .header("X-Provider-Signature", wb.computeSignature())
            .body(wb.toMap())
            .when()
            .post(ApiEndpoints.WEBHOOK_PAYMENT)
            .then()
            .statusCode(200);

        // Subscription should still be trialing
        String status = given().spec(baseSpec)
            .pathParam("id", subscriptionId)
            .when().get(ApiEndpoints.SUBSCRIPTION_BY_ID)
            .then().statusCode(200)
            .extract().path("status");

        org.assertj.core.api.Assertions.assertThat(status).isEqualTo("trialing");
    }

    // ── Helper ─────────────────────────────────────────────────────────────────

    private String createTrialingSubscription() {
        return given().spec(baseSpec)
            .body(SubscriptionRequestBuilder.defaults().toMap())
            .when().post(ApiEndpoints.SUBSCRIPTIONS)
            .then().statusCode(201)
            .extract().path("id");
    }
}
