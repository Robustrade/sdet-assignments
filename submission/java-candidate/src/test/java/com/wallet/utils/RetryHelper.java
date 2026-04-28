package com.wallet.utils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.BooleanSupplier;


public class RetryHelper {

    private static final Logger log = LoggerFactory.getLogger(RetryHelper.class);

    private RetryHelper() {}


    public static void waitUntil(String description,
                                  long timeoutMs,
                                  long intervalMs,
                                  BooleanSupplier condition) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (condition.getAsBoolean()) {
                log.debug("Condition met: {}", description);
                return;
            }
            try {
                // sleep a bit before trying again
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError("Interrupted while waiting for: " + description, e);
            }
        }
        // timed out — throw a clear error so tests don't just silently hang
        throw new AssertionError("Timeout waiting for: " + description);
    }



    public static void retry(int maxAttempts, long delayMs, Runnable action) {
        Exception last = null;
        for (int i = 1; i <= maxAttempts; i++) {
            try {
                action.run();
                return; // success — stop retrying
            } catch (Exception e) {
                last = e;
                log.warn("Attempt {}/{} failed: {}", i, maxAttempts, e.getMessage());
                if (i < maxAttempts) {
                    try { Thread.sleep(delayMs); } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new AssertionError("Interrupted during retry", ie);
                    }
                }
            }
        }
        // every attempt failed — surface the last exception
        throw new RuntimeException("All " + maxAttempts + " attempts failed", last);
    }
}
