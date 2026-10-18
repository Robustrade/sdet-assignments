package com.sdet.billing.builder;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sdet.billing.config.TestApiConfig;
import com.sdet.billing.enums.WebhookEventType;
import lombok.Builder;
import lombok.Getter;
import org.apache.commons.codec.binary.Hex;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Builder pattern — constructs inbound webhook payloads and computes
 * the HMAC-SHA256 X-Provider-Signature header.
 *
 * The same secret configured in config.properties is used here, giving
 * a genuine round-trip signature check rather than a mocked one.
 *
 * Usage:
 *   WebhookPayloadBuilder wb = WebhookPayloadBuilder.paymentSucceeded(subscriptionId);
 *   given().spec(webhookSpec)
 *       .header("X-Provider-Signature", wb.computeSignature())
 *       .body(wb.toMap())
 *       .when().post(WEBHOOK_PAYMENT)
 *       .then().statusCode(200);
 */
@Builder(toBuilder = true)
@Getter
public class WebhookPayloadBuilder {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private String eventId;
    private String type;           // wire value e.g. "payment.succeeded"
    private String subscriptionId;
    private String invoiceId;
    private int amount;
    private String currency;

    // ── Named factory methods ─────────────────────────────────────────────────

    public static WebhookPayloadBuilder paymentSucceeded(String subscriptionId) {
        return base(subscriptionId, WebhookEventType.PAYMENT_SUCCEEDED);
    }

    public static WebhookPayloadBuilder paymentFailed(String subscriptionId) {
        return base(subscriptionId, WebhookEventType.PAYMENT_FAILED);
    }

    public static WebhookPayloadBuilder paymentRefunded(String subscriptionId) {
        return base(subscriptionId, WebhookEventType.PAYMENT_REFUNDED);
    }

    // ── Payload / signature helpers ───────────────────────────────────────────

    /** Returns the payload as a map (used as RestAssured .body()). */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new HashMap<>();
        map.put("event_id",        eventId);
        map.put("type",            type);
        map.put("subscription_id", subscriptionId);
        map.put("invoice_id",      invoiceId);
        map.put("amount",          amount);
        map.put("currency",        currency);
        return map;
    }

    /**
     * Computes the HMAC-SHA256 signature over the JSON-serialised payload,
     * using the webhook secret from TestApiConfig.
     *
     * The service verifies the same computation — so this is a real sig check.
     */
    public String computeSignature() {
        return computeSignatureWithSecret(TestApiConfig.get().getWebhookSecret());
    }

    /** Compute with an arbitrary secret — use to generate deliberately wrong sigs. */
    public String computeSignatureWithSecret(String secret) {
        try {
            String body = MAPPER.writeValueAsString(toMap());
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Hex.encodeHexString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute HMAC signature", e);
        }
    }

    /** Returns a deliberately invalid (wrong) signature string. */
    public String invalidSignature() {
        return "0000000000000000000000000000000000000000000000000000000000000000";
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static WebhookPayloadBuilder base(String subscriptionId, WebhookEventType eventType) {
        return WebhookPayloadBuilder.builder()
            .eventId("evt_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8))
            .type(eventType.getWireValue())
            .subscriptionId(subscriptionId)
            .invoiceId("inv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8))
            .amount(4900)
            .currency("USD")
            .build();
    }
}
