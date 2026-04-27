package com.wallet.utils;

import io.restassured.response.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.function.Supplier;

/**
 * Runs N HTTP requests in parallel using a fixed thread pool.
 * Used by concurrency tests to simulate competing requests.
 */
public class ParallelExecutor {

    private static final Logger log = LoggerFactory.getLogger(ParallelExecutor.class);

    private ParallelExecutor() {}

    /**
     * Executes {@code requestSupplier} {@code threadCount} times concurrently.
     *
     * All threads are started at the same moment (via CyclicBarrier) to maximise
     * contention and surface race conditions.
     *
     * @param threadCount       number of parallel requests
     * @param requestSupplier   lambda that produces the HTTP Response
     * @return list of all responses (order not guaranteed)
     */
    public static List<Response> executeParallel(int threadCount,
                                                  Supplier<Response> requestSupplier) {
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        CyclicBarrier barrier = new CyclicBarrier(threadCount);
        List<Future<Response>> futures = new ArrayList<>();

        for (int i = 0; i < threadCount; i++) {
            futures.add(executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS); // synchronise start
                return requestSupplier.get();
            }));
        }

        executor.shutdown();
        try {
            executor.awaitTermination(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Parallel execution interrupted", e);
        }

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
     * Counts how many responses have the given HTTP status code.
     */
    public static long countByStatus(List<Response> responses, int statusCode) {
        return responses.stream().filter(r -> r.statusCode() == statusCode).count();
    }
}
