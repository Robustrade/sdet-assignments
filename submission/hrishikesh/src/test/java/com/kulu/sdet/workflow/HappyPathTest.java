package com.kulu.sdet.workflow;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.Invariants;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * End-to-end happy path — a single successful transfer, validated all the way from HTTP response
 * through the transfers/wallets/audit/outbox tables to the downstream notifier stub.
 */
class HappyPathTest extends ApiTestBase {

  @Test
  void successfulTransferDebitsSourceCreditsDestinationAndRecordsSideEffectsExactlyOnce() {
    long sourceBefore = 10_000L;
    long destBefore = 5_000L;
    long amount = 2_500L;
    seedWallet("wallet_a", sourceBefore);
    seedWallet("wallet_b", destBefore);
    String key = IdemKey.fresh();

    var response =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", amount, "AED", "invoice_1"));

    // 1) API level
    assertThat(response.statusCode()).isEqualTo(201);
    String transferId = response.jsonPath().getString("id");
    assertThat(transferId).isNotBlank();
    assertThat(response.jsonPath().getString("status")).isEqualTo("completed");
    assertThat(response.jsonPath().getLong("amount")).isEqualTo(amount);

    // 2) Wallet balances — exactly-once movement, conservation of the pair total
    long sourceAfter = db.balanceOf("wallet_a");
    long destAfter = db.balanceOf("wallet_b");
    Invariants.assertExactDelta(sourceBefore, destBefore, sourceAfter, destAfter, amount);
    Invariants.assertBalanceConservation(sourceBefore, destBefore, sourceAfter, destAfter);

    // 3) Transfer persisted with the same shape the API returned
    var row = db.transferRow(transferId);
    assertThat(row.get("source_wallet_id")).isEqualTo("wallet_a");
    assertThat(row.get("destination_wallet_id")).isEqualTo("wallet_b");
    assertThat(((Number) row.get("amount")).longValue()).isEqualTo(amount);
    assertThat(row.get("currency")).isEqualTo("AED");
    assertThat(row.get("status")).isEqualTo("completed");
    assertThat(row.get("idempotency_key")).isEqualTo(key);

    // 4) GET returns the same transfer view
    var getResponse = api.getTransfer(transferId);
    assertThat(getResponse.statusCode()).isEqualTo(200);
    assertThat(getResponse.jsonPath().getString("id")).isEqualTo(transferId);

    // 5) Exactly one audit row for the completed event
    assertThat(db.auditCount(transferId, "transfer_completed")).isEqualTo(1);

    // 6) Exactly one outbox row for the aggregate
    assertThat(db.outboxCount(transferId)).isEqualTo(1);
    assertThat(db.outboxCount(transferId, "TransferCompleted")).isEqualTo(1);

    // 7) Idempotency key stored with a link back to the transfer
    var idem = db.idempotencyRow(key);
    assertThat(idem.get("transfer_id")).isEqualTo(transferId);
    assertThat(((Number) idem.get("response_status")).intValue()).isEqualTo(201);

    // 8) Cross-component: draining the outbox delivers exactly one notification
    int drained = outboxRelay.drain();
    assertThat(drained).isEqualTo(1);
    assertThat(notifier.callsFor(transferId, "TransferCompleted")).isEqualTo(1);
  }
}
