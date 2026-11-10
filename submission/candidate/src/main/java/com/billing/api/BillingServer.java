package com.billing.api;

import com.billing.domain.Plan;
import com.billing.domain.Subscription;
import com.billing.domain.IllegalStateTransitionException;
import com.billing.service.NotFoundException;
import com.billing.service.SubscriptionService;
import com.billing.service.WebhookPayload;
import com.billing.service.WebhookSignatureVerifier;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import io.javalin.Javalin;
import io.javalin.http.Context;

import java.util.Map;
import java.util.Locale;

public class BillingServer {

    private final Javalin app;
    private final SubscriptionService service;
    private final WebhookSignatureVerifier signatureVerifier;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public BillingServer(SubscriptionService service,
                         WebhookSignatureVerifier signatureVerifier) {
        this.service = service;
        this.signatureVerifier = signatureVerifier;
        this.app = Javalin.create(config -> config.showJavalinBanner = false);
        registerRoutes();
    }

    private void registerRoutes() {
        app.post("/subscriptions",           this::createSubscription);
        app.get("/subscriptions/{id}",       this::getSubscription);
        app.post("/subscriptions/{id}/cancel", this::cancelSubscription);
        app.post("/webhooks/payment-provider", this::handleWebhook);
    }

    public void start(int port) { app.start(port); }
    public void stop()          { app.stop(); }

    private void createSubscription(Context ctx) {
        JsonNode body;
        try {
            body = objectMapper.readTree(ctx.body());
        } catch (JsonProcessingException e) {
            ctx.status(400).json(Map.of("error", "Malformed JSON body"));
            return;
        }
        if (body == null || !body.isObject()) {
            ctx.status(400).json(Map.of("error", "Request body must be a JSON object"));
            return;
        }

        String customerId = requiredText(body, "customer_id");
        String planStr    = requiredText(body, "plan");
        String pmId       = requiredText(body, "payment_method_id");

        if (customerId == null) {
            ctx.status(400).json(Map.of("error", "customer_id is required"));
            return;
        }
        if (pmId == null) {
            ctx.status(400).json(Map.of("error", "payment_method_id is required"));
            return;
        }
        if (planStr == null) {
            ctx.status(400).json(Map.of("error", "plan is required"));
            return;
        }

        Plan plan;
        try {
            plan = Plan.valueOf(planStr.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            ctx.status(400).json(Map.of("error", "Unknown plan: " + planStr));
            return;
        }

        try {
            Subscription sub = service.create(customerId, plan, pmId);
            ctx.status(201).json(SubscriptionResponse.from(sub));
        } catch (NotFoundException e) {
            ctx.status(404).json(Map.of("error", e.getMessage()));
        }
    }

    private void getSubscription(Context ctx) {
        try {
            Subscription sub = service.get(ctx.pathParam("id"));
            ctx.json(SubscriptionResponse.from(sub));
        } catch (NotFoundException e) {
            ctx.status(404).json(Map.of("error", e.getMessage()));
        }
    }

    private void cancelSubscription(Context ctx) {
        try {
            Subscription sub = service.cancel(ctx.pathParam("id"));
            ctx.json(SubscriptionResponse.from(sub));
        } catch (NotFoundException e) {
            ctx.status(404).json(Map.of("error", e.getMessage()));
        } catch (IllegalStateTransitionException e) {
            ctx.status(422).json(Map.of("error", e.getMessage()));
        }
    }

    private void handleWebhook(Context ctx) {
        String rawBody  = ctx.body();
        String signature = ctx.header("X-Provider-Signature");

        if (signature == null || !signatureVerifier.verify(rawBody, signature)) {
            ctx.status(401).json(Map.of("error", "Invalid or missing signature"));
            return;
        }

        JsonNode node;
        try {
            node = objectMapper.readTree(rawBody);
        } catch (JsonProcessingException e) {
            ctx.status(400).json(Map.of("error", "Malformed payload"));
            return;
        }
        if (node == null || !node.isObject()) {
            ctx.status(400).json(Map.of("error", "Payload must be a JSON object"));
            return;
        }

        String eventId = requiredText(node, "event_id");
        String type = requiredText(node, "type");
        String subscriptionId = requiredText(node, "subscription_id");
        String invoiceId = requiredText(node, "invoice_id");
        JsonNode amountNode = node.get("amount");
        if (eventId == null || type == null || subscriptionId == null || invoiceId == null
            || amountNode == null || !amountNode.isIntegralNumber()
            || !amountNode.canConvertToInt() || amountNode.asInt() <= 0) {
            ctx.status(400).json(Map.of("error", "Required webhook fields are missing or invalid"));
            return;
        }
        if (!type.equals("payment.succeeded") && !type.equals("payment.failed")
            && !type.equals("payment.refunded")) {
            ctx.status(400).json(Map.of("error", "Unsupported event type: " + type));
            return;
        }

        service.handleWebhook(new WebhookPayload(
            eventId, type, subscriptionId, invoiceId, amountNode.asInt()));
        ctx.json(Map.of("received", true));
    }

    private String requiredText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            return null;
        }
        return value.asText();
    }
}
