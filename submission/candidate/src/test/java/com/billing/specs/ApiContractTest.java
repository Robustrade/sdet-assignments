package com.billing.specs;

import org.testng.annotations.Test;

import static com.billing.builders.SubscriptionRequestBuilder.aSubscription;
import static com.billing.builders.WebhookPayloadBuilder.aPaymentSucceeded;
import static org.assertj.core.api.Assertions.assertThat;

@Test
public class ApiContractTest extends BaseTest {

    @Test(description = "returns 201 with id and status for a valid pro subscription")
    public void createProSubscription() {
        var response = subscriptionsPage.create(aSubscription().withPlan("pro").build());
        assertions.assertCreated(response);
    }

    @Test(description = "returns 201 with id and status for a valid basic subscription")
    public void createBasicSubscription() {
        var response = subscriptionsPage.create(aSubscription().withPlan("basic").build());
        assertions.assertCreated(response);
    }

    @Test(description = "returns 400 when customer_id is missing")
    public void createMissingCustomerId() {
        var response = subscriptionsPage.create(aSubscription().withoutCustomerId().build());
        assertions.assertErrorContains(response, 400, "customer_id");
    }

    @Test(description = "returns 400 when payment_method_id is missing")
    public void createMissingPaymentMethod() {
        var response = subscriptionsPage.create(aSubscription().withoutPaymentMethod().build());
        assertions.assertErrorContains(response, 400, "payment_method_id");
    }

    @Test(description = "returns 400 for an unknown plan name")
    public void createUnknownPlan() {
        var response = subscriptionsPage.create(aSubscription().withPlan("enterprise_gold").build());
        assertions.assertErrorContains(response, 400, "plan");
    }

    @Test(description = "returns 404 and does not create a subscription for an unknown customer")
    public void createUnknownCustomer() {
        var response = subscriptionsPage.create(aSubscription().withCustomerId("cust_unknown").build());
        assertions.assertErrorContains(response, 404, "customer");
        assertThat(context.getSubscriptionRepository().count()).isZero();
    }

    @Test(description = "returns 200 with subscription data for an existing id")
    public void getExistingSubscription() {
        String id = subscriptionsPage.createDefaultAndGetId();
        assertions.assertApiStatus(subscriptionsPage.getById(id), "trialing");
    }

    @Test(description = "returns 404 for an unknown subscription id")
    public void getUnknownSubscription() {
        assertions.assertHttpStatus(subscriptionsPage.getById("sub_unknown"), 404);
    }

    @Test(description = "returns 200 with canceled status after cancel")
    public void cancelSubscription() {
        String id = subscriptionsPage.createDefaultAndGetId();
        assertions.assertApiStatus(subscriptionsPage.cancel(id), "canceled");
    }

    @Test(description = "returns 404 when canceling an unknown subscription")
    public void cancelUnknownSubscription() {
        assertions.assertHttpStatus(subscriptionsPage.cancel("sub_unknown"), 404);
    }

    @Test(description = "returns 401 when X-Provider-Signature header is missing")
    public void webhookMissingSignature() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var response = webhooksPage.sendWithoutSignature(
            aPaymentSucceeded(id, "inv_001").withEventId("evt_nosig"));
        assertions.assertHttpStatus(response, 401);
    }

    @Test(description = "returns 401 when signature is invalid")
    public void webhookInvalidSignature() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var response = webhooksPage.sendWithInvalidSignature(
            aPaymentSucceeded(id, "inv_001").withEventId("evt_badsig"));
        assertions.assertHttpStatus(response, 401);
    }

    @Test(description = "returns 400 for malformed JSON payload with valid signature")
    public void webhookMalformedPayload() {
        assertions.assertHttpStatus(webhooksPage.sendMalformedPayload(), 400);
    }

    @Test(description = "returns 400 when a required webhook field is missing")
    public void webhookMissingRequiredField() {
        var response = webhooksPage.sendValid(aPaymentSucceeded("sub_001", null));
        assertions.assertErrorContains(response, 400, "fields");
    }

    @Test(description = "returns 400 when webhook amount is not positive")
    public void webhookInvalidAmount() {
        var response = webhooksPage.sendValid(
            aPaymentSucceeded("sub_001", "inv_001").withAmount(0));
        assertions.assertErrorContains(response, 400, "fields");
    }

    @Test(description = "returns 400 when webhook amount is not an integer")
    public void webhookNonIntegerAmount() {
        String raw = "{\"event_id\":\"evt_decimal\",\"type\":\"payment.succeeded\","
            + "\"subscription_id\":\"sub_001\",\"invoice_id\":\"inv_001\",\"amount\":49.5}";
        assertions.assertHttpStatus(webhooksPage.sendValidRawPayload(raw), 400);
    }

    @Test(description = "returns 400 for an unsupported webhook event type")
    public void webhookUnsupportedEventType() {
        var response = webhooksPage.sendValid(
            aPaymentSucceeded("sub_001", "inv_001").withType("payment.unknown"));
        assertions.assertErrorContains(response, 400, "unsupported");
    }

    @Test(description = "returns 200 for a valid signed webhook")
    public void webhookValidRequest() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var response = webhooksPage.sendValid(
            aPaymentSucceeded(id, "inv_001").withEventId("evt_valid_001"));
        assertions.assertHttpStatus(response, 200);
    }
}
