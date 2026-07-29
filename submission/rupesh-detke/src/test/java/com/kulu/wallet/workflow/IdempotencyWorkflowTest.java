package com.kulu.wallet.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class IdempotencyWorkflowTest extends TestEnvironment {

  @Test
  void sameKeyAndPayloadReplaysOriginalResultWithoutDoubleDebit() {
    seedWallet("wallet_001", "AED", 10_000);
    seedWallet("wallet_002", "AED", 0);

    String key = UUID.randomUUID().toString();
    Map<String, Object> body = TransferRequestBuilder.aTransfer().amount(2_000).build();

    var first = api.createTransfer(key, body);
    var second = api.createTransfer(key, body);

    assertThat(first.statusCode()).isEqualTo(201);
    // Replay returns the original logical result (same status + body), not a second create.
    assertThat(second.statusCode()).isEqualTo(201);
    assertThat(second.jsonPath().getString("transfer_id"))
        .isEqualTo(first.jsonPath().getString("transfer_id"));

    db.assertBalances("wallet_001", 8_000, "wallet_002", 2_000);
    db.assertTransferCount(1);
    db.assertIdempotencyCount(1);
    db.assertOutboxCount(1);
  }

  @Test
  void sameKeyDifferentPayloadIsConflictAndDoesNotCreateExtraSideEffects() {
    seedWallet("wallet_001", "AED", 10_000);
    seedWallet("wallet_002", "AED", 0);

    String key = UUID.randomUUID().toString();
    Map<String, Object> original = TransferRequestBuilder.aTransfer().amount(1_000).build();
    Map<String, Object> different =
        TransferRequestBuilder.aTransfer().amount(2_000).reference("other_ref").build();

    var first = api.createTransfer(key, original);
    var conflict = api.createTransfer(key, different);

    assertThat(first.statusCode()).isEqualTo(201);
    assertThat(conflict.statusCode()).isEqualTo(409);
    assertThat(conflict.jsonPath().getString("error")).isEqualTo("idempotency_conflict");

    db.assertBalances("wallet_001", 9_000, "wallet_002", 1_000);
    db.assertTransferCount(1);
    db.assertOutboxCount(1);
  }

  @Test
  void clientRetryAfterAssumedResponseLossRemainsSafe() {
    seedWallet("wallet_001", "AED", 5_000);
    seedWallet("wallet_002", "AED", 5_000);

    String key = "retry-safe-" + UUID.randomUUID();
    Map<String, Object> body = TransferRequestBuilder.aTransfer().amount(500).build();

    // Simulate: client sent request, "lost" response, then retried with same key+payload.
    var assumedLost = api.createTransfer(key, body);
    var retry = api.createTransfer(key, body);

    assertThat(assumedLost.statusCode()).isEqualTo(201);
    assertThat(retry.statusCode()).isEqualTo(201);
    assertThat(retry.jsonPath().getString("transfer_id"))
        .isEqualTo(assumedLost.jsonPath().getString("transfer_id"));

    db.assertBalances("wallet_001", 4_500, "wallet_002", 5_500);
    db.assertTransferCount(1);
    db.assertOutboxCount(1);
  }
}
