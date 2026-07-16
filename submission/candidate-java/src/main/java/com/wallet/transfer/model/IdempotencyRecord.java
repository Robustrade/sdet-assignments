package com.wallet.transfer.model;

import com.wallet.transfer.dto.TransferResponse;
import java.time.Instant;

public record IdempotencyRecord(
    String idempotencyKey, String requestHash, TransferResponse response, Instant createdAt) {
  public static IdempotencyRecord create(
      String idempotencyKey, String requestHash, TransferResponse response) {
    return new IdempotencyRecord(idempotencyKey, requestHash, response, Instant.now());
  }
}
