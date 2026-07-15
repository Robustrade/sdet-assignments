package com.kulu.sdet.idempotency;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * A retried transfer must produce exactly one of every downstream artifact: one transfer row, one
 * audit event, one outbox event, one notifier delivery. This is the invariant that catches
 * duplicate-side-effect bugs — the sort of bug that silently double-charges customers.
 */
class NoDuplicateSideEffectsTest extends ApiTestBase {

  @Test
  void tenSequentialReplaysProduceExactlyOneOfEachSideEffect() {
    seedWallet("wallet_a", 100_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    var body = transferBody("wallet_a", "wallet_b", 1_000, "AED", "invoice_x");

    String transferId = null;
    for (int i = 0; i < 10; i++) {
      var r = api.postTransfer(key, body);
      assertThat(r.statusCode()).isEqualTo(201);
      transferId = r.jsonPath().getString("id");
    }

    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
    assertThat(db.auditCount(transferId, "transfer_completed")).isEqualTo(1);
    assertThat(db.outboxCount(transferId)).isEqualTo(1);
    assertThat(db.balanceOf("wallet_a")).isEqualTo(99_000L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(1_000L);

    // Draining the outbox after all the retries still delivers exactly one notification.
    outboxRelay.drain();
    assertThat(notifier.callsFor(transferId, "TransferCompleted")).isEqualTo(1);
  }
}
