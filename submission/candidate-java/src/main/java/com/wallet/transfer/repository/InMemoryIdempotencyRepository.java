package com.wallet.transfer.repository;

import com.wallet.transfer.model.IdempotencyRecord;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

public class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private final ConcurrentMap<String, IdempotencyRecord> records = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, ReentrantLock> locks = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, CountDownLatch> completionLatches = new ConcurrentHashMap<>();

  @Override
  public IdempotencyRecord save(IdempotencyRecord record) {
    records.put(record.idempotencyKey(), record);
    CountDownLatch latch = completionLatches.remove(record.idempotencyKey());
    if (latch != null) {
      latch.countDown();
    }
    return record;
  }

  @Override
  public Optional<IdempotencyRecord> findById(String idempotencyKey) {
    return Optional.ofNullable(records.get(idempotencyKey));
  }

  @Override
  public boolean existsById(String idempotencyKey) {
    return records.containsKey(idempotencyKey);
  }

  @Override
  public boolean tryAcquireLock(String idempotencyKey) {
    ReentrantLock lock = locks.computeIfAbsent(idempotencyKey, k -> new ReentrantLock());
    return lock.tryLock();
  }

  @Override
  public IdempotencyRecord waitForCompletion(String idempotencyKey) {
    ReentrantLock lock = locks.get(idempotencyKey);
    if (lock == null) {
      return null;
    }

    CountDownLatch latch = new CountDownLatch(1);
    CountDownLatch existingLatch = completionLatches.putIfAbsent(idempotencyKey, latch);
    if (existingLatch != null) {
      latch = existingLatch;
    }

    try {
      boolean completed = latch.await(10, TimeUnit.SECONDS);
      if (!completed) {
        return null;
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return null;
    }

    return records.get(idempotencyKey);
  }

  @Override
  public void releaseLock(String idempotencyKey) {
    ReentrantLock lock = locks.remove(idempotencyKey);
    if (lock != null && lock.isHeldByCurrentThread()) {
      lock.unlock();
    }
  }

  public void clear() {
    records.clear();
    locks.clear();
    completionLatches.clear();
  }
}
