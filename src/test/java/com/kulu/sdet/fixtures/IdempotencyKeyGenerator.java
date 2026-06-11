package com.kulu.sdet.fixtures;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

public final class IdempotencyKeyGenerator {

    private static final AtomicInteger COUNTER = new AtomicInteger(0);

    private IdempotencyKeyGenerator() {
    }


    public static String random() {
        return UUID.randomUUID().toString();
    }


    public static String forTest(String testName) {
        return UUID.nameUUIDFromBytes(testName.getBytes(java.nio.charset.StandardCharsets.UTF_8))
                .toString();
    }


    public static String sequential(String prefix) {
        return prefix + "-" + COUNTER.incrementAndGet();
    }


    public static String fixed(String key) {
        return key;
    }


    public static void resetCounter() {
        COUNTER.set(0);
    }
}
