package com.kulu.sdet.idempotency;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * A retry of the same request (same key + same payload) must return the original persisted result
 * byte-for-byte and must not create any additional side effects.
 */
class SameKeySamePayloadTest extends ApiTestBase {

  @Test
  void replayReturnsTheOriginalTransferId() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    var body = transferBody("wallet_a", "wallet_b", 2_500, "AED", "invoice_1");

    var first = api.postTransfer(key, body);
    assertThat(first.statusCode()).isEqualTo(201);

    var replay = api.postTransfer(key, body);

    assertThat(replay.statusCode()).isEqualTo(201);
    assertThat(replay.header("Idempotent-Replay")).isEqualTo("true");
    assertThat(replay.jsonPath().getString("id")).isEqualTo(first.jsonPath().getString("id"));
    assertThat(replay.getBody().asString()).isEqualTo(first.getBody().asString());
  }

  @Test
  void balancesAreDebitedAndCreditedExactlyOnceAcrossManyRetries() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    var body = transferBody("wallet_a", "wallet_b", 2_500, "AED", "invoice_1");

    for (int i = 0; i < 5; i++) {
      var r = api.postTransfer(key, body);
      assertThat(r.statusCode()).isEqualTo(201);
    }

    assertThat(db.balanceOf("wallet_a")).isEqualTo(10_000L - 2_500L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(2_500L);
    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
  }
}
