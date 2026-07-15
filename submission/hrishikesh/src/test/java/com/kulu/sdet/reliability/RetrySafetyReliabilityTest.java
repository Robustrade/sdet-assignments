package com.kulu.sdet.reliability;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import io.restassured.response.Response;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The response-loss scenario: a client sends a transfer, the server persists it, the response is
 * lost in flight, and the client retries with the same idempotency key. The retry must produce the
 * same visible outcome without repeating the transfer.
 */
class RetrySafetyReliabilityTest extends ApiTestBase {

  @Test
  void retryAfterAssumedResponseLossIsSafe() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    Map<String, Object> body = transferBody("wallet_a", "wallet_b", 2_500, "AED", "invoice_r");

    // First attempt succeeds server-side.
    Response first = api.postTransfer(key, body);
    assertThat(first.statusCode()).isEqualTo(201);
    String transferId = first.jsonPath().getString("id");

    // Client "did not receive" the response and retries — server must be idempotent.
    Response retry = api.postTransfer(key, body);
    assertThat(retry.statusCode()).isEqualTo(201);
    assertThat(retry.jsonPath().getString("id")).isEqualTo(transferId);

    // No double side effects.
    assertThat(db.balanceOf("wallet_a")).isEqualTo(7_500L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(2_500L);
    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
    assertThat(db.outboxCount(transferId)).isEqualTo(1);
    assertThat(db.auditCount(transferId, "transfer_completed")).isEqualTo(1);
  }

  @Test
  void retryLoopUpToTwentyTimesStillSafe() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    Map<String, Object> body = transferBody("wallet_a", "wallet_b", 250, "AED", "invoice_r");

    String transferId = null;
    for (int i = 0; i < 20; i++) {
      Response r = api.postTransfer(key, body);
      assertThat(r.statusCode()).isEqualTo(201);
      String id = r.jsonPath().getString("id");
      if (transferId == null) {
        transferId = id;
      }
      assertThat(id).isEqualTo(transferId);
    }

    assertThat(db.balanceOf("wallet_a")).isEqualTo(9_750L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(250L);
    assertThat(db.outboxCount(transferId)).isEqualTo(1);
  }
}
