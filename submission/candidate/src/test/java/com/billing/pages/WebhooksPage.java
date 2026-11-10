package com.billing.pages;

import com.billing.builders.WebhookPayloadBuilder;
import com.billing.context.AppContext;
import com.billing.mocks.WebhookSimulator;
import io.restassured.response.Response;

import static io.restassured.RestAssured.given;

public class WebhooksPage {

    private final String baseUrl;
    private final WebhookSimulator simulator;

    public WebhooksPage(WebhookSimulator simulator) {
        this.baseUrl = AppContext.BASE_URL;
        this.simulator = simulator;
    }

    public Response sendValid(WebhookPayloadBuilder builder) {
        String raw = simulator.buildPayload(
            builder.getEventId(), builder.getType(),
            builder.getSubscriptionId(), builder.getInvoiceId(), builder.getAmount());
        return send(raw, simulator.validSignature(raw));
    }

    public Response sendWithInvalidSignature(WebhookPayloadBuilder builder) {
        String raw = simulator.buildPayload(
            builder.getEventId(), builder.getType(),
            builder.getSubscriptionId(), builder.getInvoiceId(), builder.getAmount());
        return send(raw, simulator.invalidSignature());
    }

    public Response sendWithoutSignature(WebhookPayloadBuilder builder) {
        String raw = simulator.buildPayload(
            builder.getEventId(), builder.getType(),
            builder.getSubscriptionId(), builder.getInvoiceId(), builder.getAmount());
        return given()
            .baseUri(baseUrl)
            .contentType("application/json")
            .body(raw)
            .when()
            .post("/webhooks/payment-provider");
    }

    public Response sendMalformedPayload() {
        String raw = "{bad json}";
        return send(raw, simulator.validSignature(raw));
    }

    public Response sendValidRawPayload(String raw) {
        return send(raw, simulator.validSignature(raw));
    }

    private Response send(String rawBody, String signature) {
        return given()
            .baseUri(baseUrl)
            .contentType("application/json")
            .header("X-Provider-Signature", signature)
            .body(rawBody)
            .when()
            .post("/webhooks/payment-provider");
    }
}
