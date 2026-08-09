package com.wallet.utils;

import java.util.UUID;

public class IdempotencyGenerator {
    
    /**
     * Generates a unique Type 4 UUID to be used as an Idempotency-Key header.
     * @return String representation of the UUID
     */
    public static String generateKey() {
        return UUID.randomUUID().toString();
    }
    
    /**
     * Generates a unique key with a specific prefix for debugging purposes.
     * @param prefix String prefix to append to the UUID
     * @return Prefixed UUID string
     */
    public static String generateKeyWithPrefix(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString();
    }
}