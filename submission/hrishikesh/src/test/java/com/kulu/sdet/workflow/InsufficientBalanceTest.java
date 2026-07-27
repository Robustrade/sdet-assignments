package com.kulu.sdet.workflow;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.Invariants;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * Transfers that would violate the balance floor must be rejected and must leave the system in
 * exactly the state it was in before the request.
 */
class InsufficientBalanceTest extends ApiTestBase {

  @Test
  void requestExceedingBalanceIsRejectedAndLeavesNoTrace() {
    long sourceBefore = 100L;
    long destBefore = 0L;
    seedWallet("wallet_a", sourceBefore);
    seedWallet("wallet_b", destBefore);
    String key = IdemKey.fresh();

    var response =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", 500L, "AED", "too_big"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("insufficient_balance");

    Invariants.assertBalancesUnchanged(
        sourceBefore, destBefore, db.balanceOf("wallet_a"), db.balanceOf("wallet_b"));
    assertThat(db.transferCount()).isZero();
    assertThat(db.outboxCount("wallet_a")).isZero();

    // The idempotency key still records the negative outcome so retries replay the same 422 —
    // preventing accidental double-attempts if the client re-sends after a response loss.
    assertThat(db.idempotencyRowCount(key)).isEqualTo(1);
    var idem = db.idempotencyRow(key);
    assertThat(((Number) idem.get("response_status")).intValue()).isEqualTo(422);
    assertThat(idem.get("transfer_id")).isNull();
  }

  @Test
  void rejectionReplayReturnsIdenticalErrorAndDoesNotChangeBalances() {
    seedWallet("wallet_a", 100L);
    seedWallet("wallet_b", 0L);
    String key = IdemKey.fresh();

    var first = api.postTransfer(key, transferBody("wallet_a", "wallet_b", 500L, "AED", "too_big"));
    assertThat(first.statusCode()).isEqualTo(422);

    var replay =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", 500L, "AED", "too_big"));
    assertThat(replay.statusCode()).isEqualTo(422);
    assertThat(replay.jsonPath().getString("code")).isEqualTo("insufficient_balance");
    assertThat(replay.getBody().asString()).isEqualTo(first.getBody().asString());

    assertThat(db.balanceOf("wallet_a")).isEqualTo(100L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(0L);
  }
}
