package com.billing.mocks;

import com.billing.service.WebhookSignatureVerifier;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;

public class WebhookSimulator {

    private final WebhookSignatureVerifier verifier;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public WebhookSimulator(WebhookSignatureVerifier verifier) {
        this.verifier = verifier;
    }

    public String buildPayload(String eventId, String type,
                               String subscriptionId, String invoiceId, int amount) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("event_id", eventId);
            payload.put("type", type);
            payload.put("subscription_id", subscriptionId);
            payload.put("invoice_id", invoiceId);
            payload.put("amount", amount);
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    public String validSignature(String rawBody) {
        return verifier.sign(rawBody);
    }

    public String invalidSignature() {
        return "bad-signature-000";
    }
}
