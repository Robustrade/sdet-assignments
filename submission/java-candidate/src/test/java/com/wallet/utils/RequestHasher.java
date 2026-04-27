package com.wallet.utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.codec.digest.DigestUtils;

/**
 * Hashes a transfer request body to the same SHA-256 hex string
 * that the service stores in the idempotency_keys table.
 *
 * The hash MUST match the service implementation. If the service uses
 * a different field ordering or serialisation strategy, this must be
 * updated to match. The field order here mirrors the canonical JSON
 * property order: source, dest, amount, currency, reference.
 */
public class RequestHasher {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .findAndRegisterModules();

    private RequestHasher() {}

    /** Produce a SHA-256 hex hash of any object serialised as JSON. */
    public static String hash(Object request) {
        try {
            return DigestUtils.sha256Hex(MAPPER.writeValueAsString(request));
        } catch (Exception e) {
            throw new RuntimeException("Failed to hash request", e);
        }
    }
}

