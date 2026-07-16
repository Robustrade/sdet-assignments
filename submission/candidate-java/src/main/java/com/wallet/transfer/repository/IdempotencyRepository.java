package com.wallet.transfer.repository;

import com.wallet.transfer.model.IdempotencyRecord;
import java.util.Optional;

public interface IdempotencyRepository {
  IdempotencyRecord save(IdempotencyRecord record);

  Optional<IdempotencyRecord> findById(String idempotencyKey);

  boolean existsById(String idempotencyKey);

  boolean tryAcquireLock(String idempotencyKey);

  IdempotencyRecord waitForCompletion(String idempotencyKey);

  void releaseLock(String idempotencyKey);
}
