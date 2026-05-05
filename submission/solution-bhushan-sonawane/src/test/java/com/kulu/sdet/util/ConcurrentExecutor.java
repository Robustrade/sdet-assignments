package com.kulu.sdet.util;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

public class ConcurrentExecutor {

  private static final long DEFAULT_TIMEOUT_SECONDS = 10;

  public static void run(Runnable... tasks) {
    run(DEFAULT_TIMEOUT_SECONDS, tasks);
  }

  public static void run(long timeoutSeconds, Runnable... tasks) {
    ExecutorService executor = Executors.newFixedThreadPool(tasks.length);
    List<Future<?>> futures = new ArrayList<>();
    try {
      for (Runnable task : tasks) {
        futures.add(executor.submit(task));
      }
      executor.shutdown();
      if (!executor.awaitTermination(timeoutSeconds, TimeUnit.SECONDS)) {
        throw new IllegalStateException(
            "Concurrent execution did not finish within " + timeoutSeconds + " seconds");
      }
      for (Future<?> future : futures) {
        future.get();
      }
    } catch (ExecutionException e) {
      throw new RuntimeException("Concurrent task execution failed", e.getCause());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new RuntimeException("Concurrent execution interrupted", e);
    } finally {
      executor.shutdownNow();
    }
  }
}
