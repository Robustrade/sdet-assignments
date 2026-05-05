package com.kulu.sdet.util;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ConcurrentExecutor {

  public static void run(Runnable... tasks) {
    ExecutorService executor = Executors.newFixedThreadPool(tasks.length);
    try {
      for (Runnable task : tasks) {
        executor.submit(task);
      }
      executor.shutdown();
      boolean finished = executor.awaitTermination(10, TimeUnit.SECONDS);
      if (!finished) {
        throw new RuntimeException("Concurrent tasks did not finish in time");
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new RuntimeException("Concurrency execution interrupted", e);
    } finally {
      executor.shutdownNow();
    }
  }
}
