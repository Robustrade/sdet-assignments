package com.billing.service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

public class WebhookSignatureVerifier {

    private final String secret;

    public WebhookSignatureVerifier(String secret) {
        this.secret = secret;
    }

    public boolean verify(String rawBody, String signature) {
        if (rawBody == null || signature == null) {
            return false;
        }
        byte[] expected = sign(rawBody).getBytes(StandardCharsets.US_ASCII);
        byte[] provided = signature.getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(expected, provided);
    }

    public String sign(String rawBody) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(
                mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new RuntimeException("Signing failed", e);
        }
    }
}
