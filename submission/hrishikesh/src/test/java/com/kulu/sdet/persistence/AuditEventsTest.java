package com.kulu.sdet.persistence;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Audit trail assertions. Every successful transfer produces exactly one {@code transfer_completed}
 * event referencing its transfer, with the amount and currency in the payload. Rejected transfers
 * must not produce any audit rows.
 */
class AuditEventsTest extends ApiTestBase {

  @Test
  void auditRowIsWrittenForEverySuccessfulTransfer() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 1_500, "AED", "invoice_x"));
    String transferId = response.jsonPath().getString("id");

    List<Map<String, Object>> rows = db.auditRows(transferId);
    assertThat(rows).hasSize(1);
    Map<String, Object> row = rows.get(0);
    assertThat(row.get("event_type")).isEqualTo("transfer_completed");
    String payload = String.valueOf(row.get("payload"));
    assertThat(payload).contains("1500").contains("AED");
    assertThat(row.get("created_at")).isNotNull();
  }

  @Test
  void rejectedTransferProducesNoAuditRow() {
    seedWallet("wallet_a", 100);
    seedWallet("wallet_b", 0);

    api.postTransfer(
        IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 500, "AED", "invoice_x"));

    // No transfer row means we scan the whole audit table — must be empty.
    Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM transfer_events", Integer.class);
    assertThat(total).isZero();
  }
}
