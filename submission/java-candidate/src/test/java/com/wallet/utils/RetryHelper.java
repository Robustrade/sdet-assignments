package com.wallet.utils;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.BooleanSupplier;

/**
 * Simple polling-based retry helper for eventually-consistent assertions.
 *
 * Use sparingly — prefer synchronous DB checks immediately after API calls.
 * This helper is useful for outbox / async event propagation.
 */
public class RetryHelper {

    private static final Logger log = LoggerFactory.getLogger(RetryHelper.class);

    private RetryHelper() {}

    /**
     * Polls {@code condition} every {@code intervalMs} milliseconds until it returns
     * {@code true} or {@code timeoutMs} elapses.
     *
     * @throws AssertionError if the condition is not met within the timeout
     */
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
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError("Interrupted while waiting for: " + description, e);
            }
        }
        throw new AssertionError("Timeout waiting for: " + description);
    }

    /**
     * Retries a runnable action up to {@code maxAttempts} times, sleeping
     * {@code delayMs} between attempts. On all failures throws the last exception.
     */
    public static void retry(int maxAttempts, long delayMs, Runnable action) {
        Exception last = null;
        for (int i = 1; i <= maxAttempts; i++) {
            try {
                action.run();
                return;
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
        throw new RuntimeException("All " + maxAttempts + " attempts failed", last);
    }
}
