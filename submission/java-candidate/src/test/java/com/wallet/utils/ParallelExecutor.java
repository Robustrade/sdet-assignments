package com.wallet.utils;

import io.restassured.response.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.function.Supplier;

/**
 * Fires N HTTP requests at the same time using a fixed thread pool.
 * The CyclicBarrier makes sure all threads hit the service simultaneously — that's
 * what makes race conditions actually show up.
 */
public class ParallelExecutor {

    private static final Logger log = LoggerFactory.getLogger(ParallelExecutor.class);

    // utility class — no instances needed
    private ParallelExecutor() {}

    /**
     * Runs the supplier N times in parallel. All threads wait at the barrier before
     * making their HTTP call so they really do hit the server at the same time.
     * Returns all responses once everyone is done (or after 60s timeout).
     */
    public static List<Response> executeParallel(int threadCount,
                                                  Supplier<Response> requestSupplier) {
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        // barrier ensures all threads fire at the same instant — maximises contention
        CyclicBarrier barrier = new CyclicBarrier(threadCount);
        List<Future<Response>> futures = new ArrayList<>();

        for (int i = 0; i < threadCount; i++) {
            futures.add(executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS); // wait for all threads to be ready
                return requestSupplier.get();
            }));
        }

        executor.shutdown();
        try {
            // give it a generous 60s timeout — network can be slow in some environments
            executor.awaitTermination(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Parallel execution interrupted", e);
        }

        // collect results — if any request threw, it'll blow up here
        List<Response> responses = new ArrayList<>();
        for (Future<Response> f : futures) {
            try {
                responses.add(f.get());
            } catch (Exception e) {
                throw new RuntimeException("Concurrent request failed", e);
            }
        }
        return responses;
    }

    /**
     * Quick way to count how many responses came back with a specific status code.
     */
    public static long countByStatus(List<Response> responses, int statusCode) {
        return responses.stream().filter(r -> r.statusCode() == statusCode).count();
    }
}
