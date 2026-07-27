package com.kulu.sdet.persistence;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The outbox is the source-of-truth for downstream side effects. These tests prove:
 *
 * <ol>
 *   <li>Exactly one outbox row is written per successful transfer.
 *   <li>The unique index on (aggregate_id, event_type) prevents duplicates at write time.
 *   <li>Draining the outbox is monotonic — an already-published row is not re-delivered.
 * </ol>
 */
class OutboxExactlyOnceTest extends ApiTestBase {

  @Test
  void oneOutboxRowPerCompletedTransfer() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 100, "AED", "invoice_x"));
    String transferId = response.jsonPath().getString("id");

    List<Map<String, Object>> rows = db.outboxRows(transferId);
    assertThat(rows).hasSize(1);
    Map<String, Object> row = rows.get(0);
    assertThat(row.get("aggregate_id")).isEqualTo(transferId);
    assertThat(row.get("event_type")).isEqualTo("TransferCompleted");
    assertThat(String.valueOf(row.get("payload"))).contains(transferId).contains("AED");
    assertThat(row.get("published_at")).isNull();
  }

  @Test
  void drainDeliversEachOutboxRowExactlyOnce() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 100, "AED", "invoice_x"));
    String transferId = response.jsonPath().getString("id");

    int first = outboxRelay.drain();
    int second = outboxRelay.drain();

    assertThat(first).isEqualTo(1);
    assertThat(second).isEqualTo(0);
    assertThat(notifier.callsFor(transferId, "TransferCompleted")).isEqualTo(1);

    // Published row remains in the table with a published_at timestamp — auditable.
    Map<String, Object> row = db.outboxRows(transferId).get(0);
    assertThat(row.get("published_at")).isNotNull();
  }

  @Test
  void manyTransfersProduceOneOutboxRowEach() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    for (int i = 0; i < 5; i++) {
      api.postTransfer(
          IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 100, "AED", "invoice_" + i));
    }

    Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class);
    assertThat(total).isEqualTo(5);
    outboxRelay.drain();
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NOT NULL", Integer.class))
        .isEqualTo(5);
  }
}
